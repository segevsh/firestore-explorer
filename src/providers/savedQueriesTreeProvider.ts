import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import type { ConnectionManager } from "../services/connectionManager";

/**
 * Tree structure:
 *   Connection (server)
 *     └── Folder
 *         └── query.js
 *     └── query.js
 *
 * Queries are stored at: .firestore/queries/<connectionName>/[folder/]<name>.js
 */

class ServerItem extends vscode.TreeItem {
  constructor(
    public readonly connectionName: string,
    public readonly queriesPath: string,
    connected: boolean,
  ) {
    super(connectionName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "queryServer";
    this.iconPath = new vscode.ThemeIcon(connected ? "database" : "debug-disconnect");
    this.description = connected ? "" : "disconnected";
  }
}

class FolderItem extends vscode.TreeItem {
  constructor(
    public readonly folderName: string,
    public readonly folderPath: string,
    public readonly connectionName: string,
  ) {
    super(folderName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "queryFolder";
    this.iconPath = new vscode.ThemeIcon("folder");
  }
}

class QueryFileItem extends vscode.TreeItem {
  constructor(
    public readonly fileName: string,
    public readonly filePath: string,
    public readonly connectionName: string,
  ) {
    super(fileName.replace(/\.js$/, ""), vscode.TreeItemCollapsibleState.None);
    this.contextValue = "savedQuery";
    this.iconPath = new vscode.ThemeIcon("file-code");
    this.command = {
      command: "firestoreExplorer.openSavedQuery",
      title: "Open Query",
      arguments: [filePath],
    };
    this.tooltip = filePath;
  }
}

export class SavedQueriesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private workspaceRoot: string | undefined,
    private connectionManager: ConnectionManager
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!this.workspaceRoot) return [];

    // Root: show servers (connections)
    if (!element) {
      const states = this.connectionManager.getAll();
      if (states.length === 0) return [];

      return states.map((state) => {
        const queriesPath = path.join(
          this.workspaceRoot!,
          ".firestore",
          "queries",
          state.config.name
        );
        return new ServerItem(
          state.config.name,
          queriesPath,
          state.status === "connected"
        );
      });
    }

    // Server: show folders and top-level query files
    if (element instanceof ServerItem) {
      return this.getDirectoryContents(element.queriesPath, element.connectionName);
    }

    // Folder: show contents
    if (element instanceof FolderItem) {
      return this.getDirectoryContents(element.folderPath, element.connectionName);
    }

    return [];
  }

  private getDirectoryContents(dirPath: string, connectionName: string): vscode.TreeItem[] {
    if (!fs.existsSync(dirPath)) return [];

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const items: vscode.TreeItem[] = [];

    // Folders first
    for (const entry of entries) {
      if (entry.isDirectory()) {
        items.push(new FolderItem(entry.name, path.join(dirPath, entry.name), connectionName));
      }
    }

    // Then .js files
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".js")) {
        items.push(new QueryFileItem(entry.name, path.join(dirPath, entry.name), connectionName));
      }
    }

    return items;
  }

  /** Ensure the queries directory for a connection exists and return its path. */
  ensureQueriesDir(connectionName: string, subfolder?: string): string {
    if (!this.workspaceRoot) {
      throw new Error("No workspace open");
    }
    const parts = [this.workspaceRoot, ".firestore", "queries", connectionName];
    if (subfolder) parts.push(subfolder);
    const dir = path.join(...parts);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }
}
