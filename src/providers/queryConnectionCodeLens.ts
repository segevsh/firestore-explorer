import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import type { QueryConfigService } from "../services/queryConfigService";
import type { ConnectionManager } from "../services/connectionManager";

/**
 * Shows CodeLenses at the top of:
 *   1. Any .js file under .firestore/queries/ (the saved-queries folder)
 *   2. Any .js / .ts file whose first lines contain the marker
 *      `// @firestore-query` — so you can run queries from anywhere
 *      in the workspace without moving the file.
 *
 * For marker files outside the queries folder, also shows "Add types" if the
 * globals.d.ts reference hasn't been injected yet.
 */
export const QUERY_MARKER = "@firestore-query";
const MARKER_SCAN_LINES = 20;
const REFERENCE_SCAN_LINES = 5;

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
    if (!this.isQueryCandidate(document)) return [];

    const topRange = new vscode.Range(0, 0, 0, 0);
    const filePath = document.uri.fsPath;
    const connection = this.queryConfig.getConnection(filePath);
    const label = connection ? `Connection: ${connection}` : "Select Connection…";

    const lenses: vscode.CodeLens[] = [
      new vscode.CodeLens(topRange, {
        title: `$(database) ${label}`,
        command: "firestoreExplorer.selectQueryConnection",
        arguments: [filePath],
      }),
    ];

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

    // Offer type injection for marker files that live outside the queries folder.
    // Only show if globals.d.ts exists (i.e. queries infra has been set up) and
    // the file doesn't already have the reference directive.
    if (!this.isInQueriesDir(filePath) && hasQueryMarker(document)) {
      const globalsPath = path.join(this.workspaceRoot, ".firestore", "queries", "globals.d.ts");
      if (fs.existsSync(globalsPath) && !hasGlobalsReference(document)) {
        lenses.push(
          new vscode.CodeLens(topRange, {
            title: "$(symbol-type-parameter) Add Firestore types",
            command: "firestoreExplorer.addQueryTypes",
            arguments: [filePath],
          })
        );
      }
    }

    return lenses;
  }

  private isQueryCandidate(document: vscode.TextDocument): boolean {
    const fsPath = document.uri.fsPath;
    if (!/\.(js|ts|mjs|cjs)$/i.test(fsPath)) return false;
    if (this.isInQueriesDir(fsPath)) return true;
    return hasQueryMarker(document);
  }

  private isInQueriesDir(fsPath: string): boolean {
    const queriesDir = path.join(this.workspaceRoot, ".firestore", "queries");
    const rel = path.relative(queriesDir, fsPath);
    return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
  }
}

/** Cheap marker scan — only looks at the first handful of lines. */
export function hasQueryMarker(document: vscode.TextDocument): boolean {
  const lines = Math.min(document.lineCount, MARKER_SCAN_LINES);
  for (let i = 0; i < lines; i++) {
    if (document.lineAt(i).text.includes(QUERY_MARKER)) return true;
  }
  return false;
}

/** Returns true if the file already has a /// <reference path> pointing to globals.d.ts. */
function hasGlobalsReference(document: vscode.TextDocument): boolean {
  const lines = Math.min(document.lineCount, REFERENCE_SCAN_LINES);
  for (let i = 0; i < lines; i++) {
    const text = document.lineAt(i).text;
    if (text.includes("reference path") && text.includes("globals.d.ts")) return true;
  }
  return false;
}
