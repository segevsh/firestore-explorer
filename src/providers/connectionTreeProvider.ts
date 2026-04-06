import * as vscode from "vscode";
import type { ConnectionManager } from "../services/connectionManager";
import type { ConnectionState } from "../types";

export class ConnectionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly connectionState: ConnectionState,
  ) {
    const { status, config, error } = connectionState;
    const isConnected = status === "connected";
    super(
      config.name,
      // All states are expandable — connected shows collections, others show status info
      vscode.TreeItemCollapsibleState.Collapsed
    );

    this.contextValue = `connection-${status}`;

    // Show type + host info and status
    const typeLabel = config.type === "emulator"
      ? `emulator · ${config.host}:${config.port}`
      : "production";

    if (isConnected) {
      this.description = typeLabel;
      this.iconPath = new vscode.ThemeIcon("database");
    } else if (status === "error") {
      this.description = `${typeLabel} · ⚠ error`;
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

  constructor(private connectionManager: ConnectionManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      // Root level: show connections
      const states = this.connectionManager.getAll();
      if (states.length === 0) {
        return [new InfoTreeItem("No connections configured", "info")];
      }
      return states.map((state) => new ConnectionTreeItem(state));
    }

    if (element instanceof ConnectionTreeItem) {
      const { connectionState } = element;
      if (connectionState.status !== "connected") {
        if (connectionState.status === "error") {
          return [new InfoTreeItem(`Error: ${connectionState.error ?? "unknown"}`, "warning")];
        }
        return [new InfoTreeItem("Not connected — click to connect", "plug")];
      }

      try {
        const db = this.connectionManager.getFirestore(connectionState.config.name);
        const collections = await db.listCollections();
        if (collections.length === 0) {
          return [new InfoTreeItem("No collections found", "info")];
        }
        return collections.map(
          (col) =>
            new CollectionTreeItem(
              col.id,
              connectionState.config.name,
              col.id
            )
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return [new InfoTreeItem(`Failed to list: ${message}`, "error")];
      }
    }

    return [];
  }
}
