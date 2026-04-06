import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectionManager } from "../../src/services/connectionManager";
import type { ConnectionConfig } from "../../src/types";

// Mock firebase-admin
vi.mock("firebase-admin", () => {
  const mockFirestore = {
    listCollections: vi.fn().mockResolvedValue([]),
    settings: vi.fn(),
  };
  const mockApp = {
    firestore: vi.fn().mockReturnValue(mockFirestore),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  return {
    initializeApp: vi.fn().mockReturnValue(mockApp),
    credential: {
      cert: vi.fn().mockReturnValue({}),
    },
    apps: [],
  };
});

describe("ConnectionManager", () => {
  let manager: ConnectionManager;

  beforeEach(() => {
    manager = new ConnectionManager();
  });

  it("starts with no connections", () => {
    expect(manager.getAll()).toEqual([]);
  });

  it("connects to an emulator", async () => {
    const config: ConnectionConfig = {
      name: "local",
      type: "emulator",
      host: "localhost",
      port: 8080,
    };
    await manager.connect(config);
    const states = manager.getAll();
    expect(states).toHaveLength(1);
    expect(states[0].config.name).toBe("local");
    expect(states[0].status).toBe("connected");
  });

  it("connects to production", async () => {
    const config: ConnectionConfig = {
      name: "prod",
      type: "production",
      serviceAccountPath: "/path/to/sa.json",
    };
    await manager.connect(config);
    const states = manager.getAll();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("connected");
  });

  it("supports multiple simultaneous connections", async () => {
    await manager.connect({ name: "a", type: "emulator", host: "localhost", port: 8080 });
    await manager.connect({ name: "b", type: "emulator", host: "localhost", port: 9090 });
    expect(manager.getAll()).toHaveLength(2);
  });

  it("disconnects a connection by name", async () => {
    await manager.connect({ name: "local", type: "emulator", host: "localhost", port: 8080 });
    await manager.disconnect("local");
    const states = manager.getAll();
    expect(states).toHaveLength(1);
    expect(states[0].status).toBe("disconnected");
  });

  it("returns a Firestore instance for a connected connection", async () => {
    await manager.connect({ name: "local", type: "emulator", host: "localhost", port: 8080 });
    const db = manager.getFirestore("local");
    expect(db).toBeDefined();
  });

  it("throws when getting Firestore for disconnected connection", () => {
    expect(() => manager.getFirestore("nope")).toThrow();
  });

  it("removes a connection entirely", async () => {
    await manager.connect({ name: "local", type: "emulator", host: "localhost", port: 8080 });
    await manager.remove("local");
    expect(manager.getAll()).toHaveLength(0);
  });
});
