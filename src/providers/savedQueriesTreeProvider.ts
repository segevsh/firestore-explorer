import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import type { QueryConfigService } from "../services/queryConfigService";

/**
 * Flat tree of query folders and files under .firestore/queries/.
 * Connection assignment is handled by queries.config.json, not folder structure.
 *
 * Tree:
 *   Saved Queries
 *     ├── folder/
 *     │   └── query.js  (connection: prod)
 *     └── query.js      (connection: local-emulator)
 */

class FolderItem extends vscode.TreeItem {
  constructor(
    public readonly folderName: string,
    public readonly folderPath: string,
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
    connectionName: string | undefined,
  ) {
    super(fileName.replace(/\.js$/, ""), vscode.TreeItemCollapsibleState.None);
    this.contextValue = "savedQuery";
    this.iconPath = new vscode.ThemeIcon("file-code");
    this.description = connectionName ?? "no connection";
    this.command = {
      command: "firestoreExplorer.openSavedQuery",
      title: "Open Query",
      arguments: [filePath],
    };
    this.tooltip = `${filePath}\nConnection: ${connectionName ?? "none"}`;
  }
}

export class SavedQueriesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private workspaceRoot: string | undefined,
    private queryConfig: QueryConfigService | undefined,
  ) {}

  refresh(): void {
    this.queryConfig?.invalidate();
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!this.workspaceRoot) return [];

    const queriesDir = path.join(this.workspaceRoot, ".firestore", "queries");

    if (!element) {
      // Root: show top-level contents of .firestore/queries/
      if (!fs.existsSync(queriesDir)) return [];
      return this.getDirectoryContents(queriesDir);
    }

    if (element instanceof FolderItem) {
      return this.getDirectoryContents(element.folderPath);
    }

    return [];
  }

  private getDirectoryContents(dirPath: string): vscode.TreeItem[] {
    if (!fs.existsSync(dirPath)) return [];

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const items: vscode.TreeItem[] = [];

    // Folders first
    for (const entry of entries) {
      if (entry.isDirectory()) {
        items.push(new FolderItem(entry.name, path.join(dirPath, entry.name)));
      }
    }

    // Then .js files
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".js")) {
        const filePath = path.join(dirPath, entry.name);
        const connection = this.queryConfig?.getConnection(filePath);
        items.push(new QueryFileItem(entry.name, filePath, connection));
      }
    }

    return items;
  }

  /** Ensure the queries directory exists and return its path. */
  ensureQueriesDir(subfolder?: string): string {
    if (!this.workspaceRoot) {
      throw new Error("No workspace open");
    }
    const parts = [this.workspaceRoot, ".firestore", "queries"];
    if (subfolder) parts.push(subfolder);
    const dir = path.join(...parts);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }
}
