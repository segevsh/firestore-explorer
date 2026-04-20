import * as net from "net";
import * as admin from "firebase-admin";
import type { ConnectionConfig, ConnectionState } from "../types";

const EMULATOR_PROBE_TIMEOUT_MS = 2000;
const EMULATOR_VERIFY_TIMEOUT_MS = 5000;
const PRODUCTION_VERIFY_TIMEOUT_MS = 15000;

type Listener = () => void;

type ProbeFn = (host: string, port: number, timeoutMs: number, signal: AbortSignal) => Promise<void>;

export interface ConnectionManagerOptions {
  /** Override the TCP reachability probe (used in tests to avoid real sockets). */
  probe?: ProbeFn;
}

export class ConnectionManager {
  private states: Map<string, ConnectionState> = new Map();
  private apps: Map<string, admin.app.App> = new Map();
  private firestoreInstances: Map<string, admin.firestore.Firestore> = new Map();
  private inflight: Map<string, AbortController> = new Map();
  private listeners: Set<Listener> = new Set();
  private probe: ProbeFn;

  constructor(options: ConnectionManagerOptions = {}) {
    this.probe = options.probe ?? probeTcp;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) {
      try { l(); } catch { /* ignore listener errors */ }
    }
  }

  getAll(): ConnectionState[] {
    return Array.from(this.states.values());
  }

  getState(name: string): ConnectionState | undefined {
    return this.states.get(name);
  }

  /** Register a connection config without connecting. Shows as disconnected in the tree. */
  register(config: ConnectionConfig): void {
    if (!this.states.has(config.name)) {
      this.states.set(config.name, { config, status: "disconnected" });
    }
  }

  isConnecting(name: string): boolean {
    return this.inflight.has(name);
  }

  /** Abort an in-flight connect attempt. Returns true if one was cancelled. */
  cancel(name: string): boolean {
    const controller = this.inflight.get(name);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  async connect(config: ConnectionConfig): Promise<void> {
    // Cancel any in-flight attempt for the same name
    this.cancel(config.name);

    // Disconnect any existing live connection
    if (this.apps.has(config.name)) {
      await this.disconnect(config.name);
    }

    const controller = new AbortController();
    this.inflight.set(config.name, controller);
    this.states.set(config.name, { config, status: "connecting" });
    this.notify();

    let app: admin.app.App | undefined;

    try {
      // Fast-fail probe for emulator connections
      if (config.type === "emulator") {
        await this.probe(config.host, config.port, EMULATOR_PROBE_TIMEOUT_MS, controller.signal);
      }

      throwIfAborted(controller.signal);

      if (config.type === "emulator") {
        const projectId = config.projectId ?? `emulator-${config.name}`;
        app = admin.initializeApp({ projectId }, config.name);
        const firestore = app.firestore();
        firestore.settings({ host: `${config.host}:${config.port}`, ssl: false });
        this.firestoreInstances.set(config.name, firestore);
      } else {
        const credential = admin.credential.cert(config.serviceAccountPath);
        app = admin.initializeApp({ credential }, config.name);
        this.firestoreInstances.set(config.name, app.firestore());
      }

      throwIfAborted(controller.signal);

      // Verify connectivity with a bounded timeout
      const verifyTimeout = config.type === "emulator"
        ? EMULATOR_VERIFY_TIMEOUT_MS
        : PRODUCTION_VERIFY_TIMEOUT_MS;
      const firestore = this.firestoreInstances.get(config.name)!;
      await raceWithTimeoutAndAbort(
        firestore.listCollections(),
        verifyTimeout,
        controller.signal,
        `Connection timed out after ${verifyTimeout}ms`
      );

      this.apps.set(config.name, app);
      this.states.set(config.name, { config, status: "connected" });
    } catch (err) {
      this.firestoreInstances.delete(config.name);
      if (app) {
        try { await app.delete(); } catch { /* app may already be torn down */ }
      }

      if (controller.signal.aborted) {
        this.states.set(config.name, { config, status: "disconnected" });
      } else {
        const message = normalizeConnectError(err, config);
        this.states.set(config.name, { config, status: "error", error: message });
      }
      throw err;
    } finally {
      if (this.inflight.get(config.name) === controller) {
        this.inflight.delete(config.name);
      }
      this.notify();
    }
  }

  async disconnect(name: string): Promise<void> {
    this.cancel(name);
    const app = this.apps.get(name);
    if (app) {
      await app.delete();
      this.apps.delete(name);
    }
    this.firestoreInstances.delete(name);
    const state = this.states.get(name);
    if (state) {
      this.states.set(name, { ...state, status: "disconnected", error: undefined });
    }
    this.notify();
  }

  async remove(name: string): Promise<void> {
    await this.disconnect(name);
    this.states.delete(name);
    this.notify();
  }

  getFirestore(name: string): admin.firestore.Firestore {
    const firestore = this.firestoreInstances.get(name);
    if (!firestore) {
      throw new Error(`No connected Firestore for "${name}"`);
    }
    return firestore;
  }

  getApp(name: string): admin.app.App {
    const app = this.apps.get(name);
    if (!app) {
      throw new Error(`No connected app for "${name}"`);
    }
    return app;
  }

  /** Get the connection config for a connected connection. */
  getConfig(name: string): ConnectionConfig {
    const state = this.states.get(name);
    if (!state) {
      throw new Error(`No connection "${name}"`);
    }
    return state.config;
  }

  /** Get production auth instance (admin SDK). Throws if connection is emulator. */
  getAuth(name: string): admin.auth.Auth {
    const config = this.getConfig(name);
    if (config.type === "emulator") {
      throw new Error(`Use EmulatorAuthService for emulator connection "${name}"`);
    }
    return this.getApp(name).auth();
  }

  async disconnectAll(): Promise<void> {
    for (const name of this.apps.keys()) {
      await this.disconnect(name);
    }
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const err = new Error("Aborted");
    (err as any).name = "AbortError";
    throw err;
  }
}

function probeTcp(host: string, port: number, timeoutMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      socket.removeAllListeners();
      socket.destroy();
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Emulator not reachable at ${host}:${port} (no response in ${timeoutMs}ms)`));
    }, timeoutMs);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const err = new Error("Aborted");
      (err as any).name = "AbortError";
      reject(err);
    };

    signal.addEventListener("abort", onAbort);

    socket.once("connect", () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    });

    socket.once("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      cleanup();
      const hint = err.code === "ECONNREFUSED"
        ? `Emulator not running at ${host}:${port} (connection refused)`
        : `Emulator not reachable at ${host}:${port}: ${err.message}`;
      reject(new Error(hint));
    });

    try {
      socket.connect(port, host);
    } catch (err) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    }
  });
}

function raceWithTimeoutAndAbort<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
  timeoutMessage: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const err = new Error("Aborted");
      (err as any).name = "AbortError";
      reject(err);
    };

    signal.addEventListener("abort", onAbort);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}

function normalizeConnectError(err: unknown, config: ConnectionConfig): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (config.type === "emulator" && /ECONNREFUSED|not reachable|not running|timed out/i.test(raw)) {
    return raw;
  }
  return raw;
}
