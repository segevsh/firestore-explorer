import * as vscode from "vscode";
import type { ConnectionManager } from "../services/connectionManager";
import type { ConnectionConfig } from "../types";

class AuthConnectionItem extends vscode.TreeItem {
  constructor(
    public readonly connectionName: string,
    public readonly connectionConfig: ConnectionConfig,
    connected: boolean,
  ) {
    super(connectionName, vscode.TreeItemCollapsibleState.None);

    const typeLabel = connectionConfig.type === "emulator"
      ? `emulator · ${connectionConfig.host}:${connectionConfig.port}`
      : "production";

    if (connected) {
      this.description = typeLabel;
      this.iconPath = new vscode.ThemeIcon("person");
      this.contextValue = "authConnection-connected";
      this.command = {
        command: "firestoreExplorer.openAuth",
        title: "Open Auth",
        arguments: [connectionName],
      };
    } else {
      this.description = `${typeLabel} · disconnected`;
      this.iconPath = new vscode.ThemeIcon("debug-disconnect");
      this.contextValue = "authConnection-disconnected";
    }
  }
}

export class AuthTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private connectionManager: ConnectionManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const states = this.connectionManager.getAll();
    if (states.length === 0) {
      const info = new vscode.TreeItem("No connections configured");
      info.iconPath = new vscode.ThemeIcon("info");
      return [info];
    }

    return states.map(
      (state) =>
        new AuthConnectionItem(
          state.config.name,
          state.config,
          state.status === "connected"
        )
    );
  }
}
