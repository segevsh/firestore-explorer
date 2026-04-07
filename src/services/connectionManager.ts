import * as admin from "firebase-admin";
import type { ConnectionConfig, ConnectionState } from "../types";

export class ConnectionManager {
  private states: Map<string, ConnectionState> = new Map();
  private apps: Map<string, admin.app.App> = new Map();
  private firestoreInstances: Map<string, admin.firestore.Firestore> = new Map();
  /** Emulator auth host strings keyed by connection name, e.g. "localhost:9099" */
  private emulatorAuthHosts: Map<string, string> = new Map();

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

  async connect(config: ConnectionConfig): Promise<void> {
    // Disconnect existing if reconnecting
    if (this.apps.has(config.name)) {
      await this.disconnect(config.name);
    }

    // Clear emulator env vars — we manage them per-call
    delete process.env["FIRESTORE_EMULATOR_HOST"];
    delete process.env["FIREBASE_AUTH_EMULATOR_HOST"];

    let app: admin.app.App;

    if (config.type === "emulator") {
      const projectId = config.projectId ?? `emulator-${config.name}`;

      // Set auth emulator env var BEFORE initializing app so auth instance picks it up
      const authHost = `${config.host}:${config.authPort ?? 9099}`;
      process.env["FIREBASE_AUTH_EMULATOR_HOST"] = authHost;
      this.emulatorAuthHosts.set(config.name, authHost);

      app = admin.initializeApp({ projectId }, config.name);

      // Force auth instance creation while env var is set
      app.auth();

      // Clear env var after auth instance is cached
      delete process.env["FIREBASE_AUTH_EMULATOR_HOST"];

      // Configure Firestore instance directly (no env var needed)
      const firestore = app.firestore();
      firestore.settings({
        host: `${config.host}:${config.port}`,
        ssl: false,
      });
      this.firestoreInstances.set(config.name, firestore);
    } else {
      const credential = admin.credential.cert(config.serviceAccountPath);
      app = admin.initializeApp({ credential }, config.name);
      this.firestoreInstances.set(config.name, app.firestore());
    }

    // Verify connectivity by listing collections
    try {
      const firestore = this.firestoreInstances.get(config.name)!;
      await firestore.listCollections();
      this.apps.set(config.name, app);
      this.states.set(config.name, { config, status: "connected" });
    } catch (err) {
      this.firestoreInstances.delete(config.name);
      this.emulatorAuthHosts.delete(config.name);
      await app.delete();
      const message = err instanceof Error ? err.message : String(err);
      this.states.set(config.name, { config, status: "error", error: message });
      throw err;
    }
  }

  async disconnect(name: string): Promise<void> {
    const app = this.apps.get(name);
    if (app) {
      await app.delete();
      this.apps.delete(name);
    }
    this.firestoreInstances.delete(name);
    this.emulatorAuthHosts.delete(name);
    const state = this.states.get(name);
    if (state) {
      this.states.set(name, { ...state, status: "disconnected", error: undefined });
    }
  }

  async remove(name: string): Promise<void> {
    await this.disconnect(name);
    this.states.delete(name);
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

  getAuth(name: string): admin.auth.Auth {
    const app = this.getApp(name);
    return app.auth();
  }

  async disconnectAll(): Promise<void> {
    for (const name of this.apps.keys()) {
      await this.disconnect(name);
    }
  }
}
