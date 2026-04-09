import * as vscode from "vscode";
import * as path from "path";
import type { QueryConfigService } from "../services/queryConfigService";
import type { ConnectionManager } from "../services/connectionManager";

/**
 * Provides a CodeLens at the top of .js files inside .firestore/queries/
 * showing the assigned connection with a click-to-change action.
 *
 * Also adds a "Run Query" CodeLens next to it.
 */
export class QueryConnectionCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(
    private workspaceRoot: string,
    private queryConfig: QueryConfigService,
    private connectionManager: ConnectionManager
  ) {}

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.isQueryFile(document.uri.fsPath)) return [];

    const topRange = new vscode.Range(0, 0, 0, 0);
    const filePath = document.uri.fsPath;
    const connection = this.queryConfig.getConnection(filePath);
    const label = connection ? `Connection: ${connection}` : "Select Connection…";

    const selectLens = new vscode.CodeLens(topRange, {
      title: `$(database) ${label}`,
      command: "firestoreExplorer.selectQueryConnection",
      arguments: [filePath],
    });

    const lenses = [selectLens];

    // Add Run button if connection is set and connected
    if (connection) {
      const state = this.connectionManager.getState(connection);
      const isConnected = state?.status === "connected";

      lenses.push(
        new vscode.CodeLens(topRange, {
          title: isConnected ? "$(play) Run Query" : "$(play) Run Query (not connected)",
          command: "firestoreExplorer.runSavedQuery",
          arguments: [{ filePath, connectionName: connection }],
        })
      );
    }

    return lenses;
  }

  private isQueryFile(fsPath: string): boolean {
    if (!fsPath.endsWith(".js")) return false;
    const queriesDir = path.join(this.workspaceRoot, ".firestore", "queries");
    return fsPath.startsWith(queriesDir);
  }
}
