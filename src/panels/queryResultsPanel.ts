import * as vscode from "vscode";
import * as path from "path";
import type { ConnectionManager } from "../services/connectionManager";
import type { FirestoreFileSystemProvider } from "../providers/firestoreFileSystemProvider";
import type { QueryResult } from "../services/queryRunner";
import { FirestoreService } from "../services/firestoreService";
import type { WebviewToHostMessage } from "../types";

/**
 * Shows query results in a webview panel beside the query editor.
 * Reuses the CollectionView component for collection/document snapshots
 * and shows raw JSON for other result types.
 *
 * The panel is reused across runs — calling update() replaces the results.
 */
export class QueryResultsPanel {
  private panel: vscode.WebviewPanel;
  private currentConnectionName: string;

  constructor(
    private context: vscode.ExtensionContext,
    private connectionManager: ConnectionManager,
    private fsProvider: FirestoreFileSystemProvider,
    connectionName: string,
    result: QueryResult,
  ) {
    this.currentConnectionName = connectionName;

    this.panel = vscode.window.createWebviewPanel(
      "firestoreQueryResults",
      "Query Results",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, "webview", "dist")),
        ],
      }
    );

    this.panel.webview.html = this.getHtml(connectionName, result);
    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToHostMessage) => this.handleMessage(msg),
      undefined,
      []
    );
  }

  get disposed(): boolean {
    try {
      // Accessing .visible on a disposed panel throws
      void this.panel.visible;
      return false;
    } catch {
      return true;
    }
  }

  /** Update results in-place without creating a new panel. */
  update(connectionName: string, result: QueryResult): void {
    this.currentConnectionName = connectionName;
    this.panel.webview.html = this.getHtml(connectionName, result);
    this.panel.title = "Query Results";
  }

  private async handleMessage(msg: WebviewToHostMessage) {
    try {
      switch (msg.type) {
        case "fetchSubCollections": {
          const db = this.connectionManager.getFirestore(msg.connectionName);
          const svc = new FirestoreService(db);
          const collections = await svc.listSubCollections(msg.docPath);
          this.panel.webview.postMessage({ type: "collections", collections });
          break;
        }
        case "openDocument": {
          new (await import("./documentEditorPanel")).DocumentEditorPanel(
            this.context,
            this.connectionManager,
            this.fsProvider,
            msg.connectionName,
            msg.docPath
          );
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.panel.webview.postMessage({ type: "error", message });
    }
  }

  private getHtml(connectionName: string, result: QueryResult): string {
    const webviewDistPath = path.join(this.context.extensionPath, "webview", "dist");
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(path.join(webviewDistPath, "assets", "index.js"))
    );
    const styleUri = this.panel.webview.asWebviewUri(
      vscode.Uri.file(path.join(webviewDistPath, "assets", "index.css"))
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}">
    window.__PANEL_TYPE__ = "queryResults";
    window.__INITIAL_DATA__ = ${JSON.stringify({
      connectionName,
      resultType: result.resultType,
      documents: result.documents,
      rawOutput: result.rawOutput,
      logs: result.logs ?? [],
    })};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
