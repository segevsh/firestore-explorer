import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import type { ConnectionManager } from "../services/connectionManager";
import { FirestoreService } from "../services/firestoreService";
import { ensureQueriesInfra } from "../utils/queriesInfra";
import type { WebviewToHostMessage } from "../types";

export class QueryBuilderPanel {
  private panel: vscode.WebviewPanel;

  constructor(
    private context: vscode.ExtensionContext,
    private connectionManager: ConnectionManager,
    connectionName: string,
    private workspaceRoot?: string
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "firestoreQueryBuilder",
      `Query Builder (${connectionName})`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, "webview", "dist")),
        ],
      }
    );

    this.panel.webview.html = this.getHtml(connectionName);
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      undefined,
      []
    );
  }

  private async handleMessage(msg: WebviewToHostMessage & { name?: string; code?: string }) {
    try {
      switch (msg.type) {
        case "fetchDocuments": {
          // Special case: list collections
          if ((msg as any).collectionPath === "__list_collections__") {
            const db = this.connectionManager.getFirestore(msg.connectionName);
            const svc = new FirestoreService(db);
            const collections = await svc.listCollections();
            this.panel.webview.postMessage({ type: "collections", collections });
            return;
          }
          break;
        }
        case "runQuery": {
          const db = this.connectionManager.getFirestore(msg.connectionName);
          const svc = new FirestoreService(db);
          const result = await svc.executeQuery(msg.query);
          this.panel.webview.postMessage({
            type: "queryResult",
            documents: result.documents,
            hasMore: result.hasMore,
          });
          break;
        }
        case "saveQuery" as any: {
          const { name, code } = msg as any;
          if (!this.workspaceRoot || !name || !code) return;
          const queriesDir = path.join(this.workspaceRoot, ".firestore", "queries");
          ensureQueriesInfra(queriesDir);
          const filePath = path.join(queriesDir, `${name}.js`);
          fs.writeFileSync(filePath, code, "utf-8");
          vscode.window.showInformationMessage(`Query saved: ${name}.js`);
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.panel.webview.postMessage({ type: "error", message });
    }
  }

  private getHtml(connectionName: string): string {
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
    window.__PANEL_TYPE__ = "queryBuilder";
    window.__INITIAL_DATA__ = ${JSON.stringify({ connectionName })};
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
