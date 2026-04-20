import * as vscode from "vscode";
import type { ConnectionManager } from "../services/connectionManager";
import type { ConnectionConfig, ConnectionState } from "../types";

export class ConnectionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly connectionState: ConnectionState,
  ) {
    const { status, config, error } = connectionState;
    super(config.name, vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = `connection-${status}`;

    const typeLabel = config.type === "emulator"
      ? `emulator · ${config.host}:${config.port}`
      : "production";

    if (status === "connected") {
      this.description = typeLabel;
      this.iconPath = new vscode.ThemeIcon("database");
    } else if (status === "connecting") {
      this.description = `${typeLabel} · connecting…`;
      this.iconPath = new vscode.ThemeIcon("sync~spin");
    } else if (status === "error") {
      this.description = `${typeLabel} · ⚠ unreachable`;
      this.tooltip = error ?? "Connection failed";
      this.iconPath = new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground"));
    } else {
      this.description = `${typeLabel} · disconnected`;
      this.iconPath = new vscode.ThemeIcon("debug-disconnect");
    }
  }
}

export class CollectionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly collectionName: string,
    public readonly connectionName: string,
    public readonly collectionPath: string,
  ) {
    super(collectionName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "collection";
    this.iconPath = new vscode.ThemeIcon("folder");
    this.command = {
      command: "firestoreExplorer.openCollection",
      title: "Open Collection",
      arguments: [connectionName, collectionPath],
    };
  }
}

class InfoTreeItem extends vscode.TreeItem {
  constructor(label: string, icon?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    if (icon) {
      this.iconPath = new vscode.ThemeIcon(icon);
    }
  }
}

export class ConnectionTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private collectionFilter = "";

  constructor(
    private connectionManager: ConnectionManager,
    private resolveConnection: (config: ConnectionConfig) => ConnectionConfig
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  setFilter(filter: string): void {
    this.collectionFilter = filter.toLowerCase();
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      const states = this.connectionManager.getAll();
      if (states.length === 0) {
        return [new InfoTreeItem("No connections configured", "info")];
      }
      return states.map((state) => new ConnectionTreeItem(state));
    }

    if (element instanceof ConnectionTreeItem) {
      const { connectionState } = element;

      // Auto-connect on expand if not yet connected. Fire-and-forget: the
      // connectionManager flips state to "connecting" synchronously and
      // notifies listeners on every transition so the tree refreshes itself.
      if (connectionState.status === "disconnected") {
        this.connectionManager
          .connect(this.resolveConnection(connectionState.config))
          .catch(() => { /* error/cancel reflected in state */ });
        return [new InfoTreeItem("Connecting…", "sync~spin")];
      }

      if (connectionState.status === "connecting") {
        return [new InfoTreeItem("Connecting…", "sync~spin")];
      }

      if (connectionState.status === "error") {
        return [new InfoTreeItem(`⚠ ${connectionState.error ?? "Unreachable"}`, "warning")];
      }

      try {
        const db = this.connectionManager.getFirestore(connectionState.config.name);
        const collections = await db.listCollections();
        if (collections.length === 0) {
          return [new InfoTreeItem("No collections found", "info")];
        }

        let items = collections.map(
          (col) =>
            new CollectionTreeItem(
              col.id,
              connectionState.config.name,
              col.id
            )
        );

        // Apply search filter
        if (this.collectionFilter) {
          items = items.filter((item) =>
            item.collectionName.toLowerCase().includes(this.collectionFilter)
          );
          if (items.length === 0) {
            return [new InfoTreeItem(`No collections matching "${this.collectionFilter}"`, "search")];
          }
        }

        return items;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return [new InfoTreeItem(`Failed to list: ${message}`, "error")];
      }
    }

    return [];
  }
}
