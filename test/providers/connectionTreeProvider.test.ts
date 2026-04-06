import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectionTreeProvider, ConnectionTreeItem } from "../../src/providers/connectionTreeProvider";
import { ConnectionManager } from "../../src/services/connectionManager";
import type { ConnectionConfig, ConnectionState } from "../../src/types";

// Mock vscode module
vi.mock("vscode", () => ({
  TreeItem: class {
    label: string;
    collapsibleState: number;
    contextValue?: string;
    description?: string;
    iconPath?: unknown;
    command?: unknown;
    tooltip?: string;
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class {
    id: string;
    color?: unknown;
    constructor(id: string, color?: unknown) { this.id = id; this.color = color; }
  },
  ThemeColor: class {
    id: string;
    constructor(id: string) { this.id = id; }
  },
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
  },
}));

const identity = (c: ConnectionConfig) => c;

describe("ConnectionTreeProvider", () => {
  let provider: ConnectionTreeProvider;
  let mockManager: Partial<ConnectionManager>;

  beforeEach(() => {
    mockManager = {
      getAll: vi.fn().mockReturnValue([]),
      getFirestore: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
    };
    provider = new ConnectionTreeProvider(mockManager as ConnectionManager, identity);
  });

  it("returns info item when no connections", async () => {
    const children = await provider.getChildren();
    expect(children).toHaveLength(1);
    expect(children[0].label).toBe("No connections configured");
  });

  it("returns connection nodes at root level", async () => {
    const states: ConnectionState[] = [
      { config: { name: "local", type: "emulator", host: "localhost", port: 8080 }, status: "connected" },
      { config: { name: "prod", type: "production", serviceAccountPath: "/sa.json" }, status: "disconnected" },
    ];
    (mockManager.getAll as any).mockReturnValue(states);

    const children = await provider.getChildren();
    expect(children).toHaveLength(2);
    expect(children[0].label).toBe("local");
    expect(children[1].label).toBe("prod");
  });

  it("shows connection type and status in description", async () => {
    const states: ConnectionState[] = [
      { config: { name: "local", type: "emulator", host: "localhost", port: 8080 }, status: "connected" },
    ];
    (mockManager.getAll as any).mockReturnValue(states);

    const children = await provider.getChildren();
    expect(children[0].description).toBe("emulator · localhost:8080");
    expect(children[0].contextValue).toBe("connection-connected");
  });

  it("returns collection names when expanding a connected connection", async () => {
    const mockFirestore = {
      listCollections: vi.fn().mockResolvedValue([{ id: "users" }, { id: "orders" }]),
    };
    (mockManager.getFirestore as any).mockReturnValue(mockFirestore);

    const connectionItem = new ConnectionTreeItem(
      { config: { name: "local", type: "emulator", host: "localhost", port: 8080 }, status: "connected" },
    );
    const children = await provider.getChildren(connectionItem);
    expect(children).toHaveLength(2);
    expect(children[0].label).toBe("users");
    expect(children[1].label).toBe("orders");
  });

  it("filters collections when search is active", async () => {
    const mockFirestore = {
      listCollections: vi.fn().mockResolvedValue([{ id: "users" }, { id: "orders" }, { id: "userProfiles" }]),
    };
    (mockManager.getFirestore as any).mockReturnValue(mockFirestore);

    provider.setFilter("user");

    const connectionItem = new ConnectionTreeItem(
      { config: { name: "local", type: "emulator", host: "localhost", port: 8080 }, status: "connected" },
    );
    const children = await provider.getChildren(connectionItem);
    expect(children).toHaveLength(2);
    expect(children[0].label).toBe("users");
    expect(children[1].label).toBe("userProfiles");
  });
});
