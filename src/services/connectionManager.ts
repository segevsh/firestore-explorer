import * as admin from "firebase-admin";
import type { ConnectionConfig, ConnectionState } from "../types";

export class ConnectionManager {
  private states: Map<string, ConnectionState> = new Map();
  private apps: Map<string, admin.app.App> = new Map();
  private firestoreInstances: Map<string, admin.firestore.Firestore> = new Map();

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

    // Never set FIRESTORE_EMULATOR_HOST — we configure each instance directly
    delete process.env["FIRESTORE_EMULATOR_HOST"];

    let app: admin.app.App;

    if (config.type === "emulator") {
      const projectId = config.projectId ?? `emulator-${config.name}`;
      app = admin.initializeApp({ projectId }, config.name);

      // Configure this Firestore instance to talk to the specific emulator
      // via host/port settings — no process-global env var needed
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

  async disconnectAll(): Promise<void> {
    for (const name of this.apps.keys()) {
      await this.disconnect(name);
    }
  }
}
