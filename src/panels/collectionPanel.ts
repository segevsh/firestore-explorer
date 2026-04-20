import * as vscode from "vscode";
import * as path from "path";
import type { ConnectionManager } from "../services/connectionManager";
import { FirestoreService } from "../services/firestoreService";
import type { FirestoreFileSystemProvider } from "../providers/firestoreFileSystemProvider";
import type { LogEntry, WebviewToHostMessage } from "../types";

function makeReadLogs(label: string, start: number, count: number, hasMore: boolean): LogEntry[] {
  const end = Date.now();
  return [
    {
      level: "info",
      timestamp: start,
      message: `${label} started`,
    },
    {
      level: "info",
      timestamp: end,
      message: `${label} completed in ${end - start}ms — ${count} document${count === 1 ? "" : "s"}${hasMore ? " (more available)" : ""}`,
    },
  ];
}

export class CollectionPanel {
  private panel: vscode.WebviewPanel;
  private firestoreService: FirestoreService;

  constructor(
    private context: vscode.ExtensionContext,
    private connectionManager: ConnectionManager,
    private fsProvider: FirestoreFileSystemProvider,
    connectionName: string,
    collectionPath: string
  ) {
    const db = this.connectionManager.getFirestore(connectionName);
    this.firestoreService = new FirestoreService(db);

    this.panel = vscode.window.createWebviewPanel(
      "firestoreCollection",
      `${collectionPath} (${connectionName})`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, "webview", "dist")),
        ],
      }
    );

    this.panel.webview.html = this.getHtml(connectionName, collectionPath, "collection");
    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToHostMessage) => this.handleMessage(msg),
      undefined,
      []
    );
  }

  private async handleMessage(msg: WebviewToHostMessage) {
    try {
      switch (msg.type) {
        case "fetchDocuments": {
          const db = this.connectionManager.getFirestore(msg.connectionName);
          const svc = new FirestoreService(db);
          const start = Date.now();
          const result = await svc.getDocuments(msg.collectionPath, msg.limit);
          const logs = makeReadLogs(
            `Read ${msg.collectionPath} (limit ${msg.limit})`,
            start,
            result.documents.length,
            result.hasMore
          );
          this.panel.webview.postMessage({
            type: "loadDocuments",
            documents: result.documents,
            hasMore: result.hasMore,
            logs,
          });
          break;
        }
        case "fetchMore": {
          const db = this.connectionManager.getFirestore(msg.connectionName);
          const svc = new FirestoreService(db);
          const start = Date.now();
          const result = await svc.getDocuments(msg.collectionPath, msg.limit, msg.afterDocId);
          const logs = makeReadLogs(
            `Read more ${msg.collectionPath} (limit ${msg.limit}, after ${msg.afterDocId})`,
            start,
            result.documents.length,
            result.hasMore
          );
          this.panel.webview.postMessage({
            type: "appendDocuments",
            documents: result.documents,
            hasMore: result.hasMore,
            logs,
          });
          break;
        }
        case "fetchSubCollections": {
          const db = this.connectionManager.getFirestore(msg.connectionName);
          const svc = new FirestoreService(db);
          const collections = await svc.listSubCollections(msg.docPath);
          this.panel.webview.postMessage({
            type: "collections",
            collections,
          });
          break;
        }
        case "openDocument": {
          // Open document in VS Code's native JSON editor with metadata panel
          new (await import("./documentEditorPanel")).DocumentEditorPanel(
            this.context,
            this.connectionManager,
            this.fsProvider,
            msg.connectionName,
            msg.docPath
          );
          break;
        }
        case "saveDocument": {
          const db = this.connectionManager.getFirestore(msg.connectionName);
          const svc = new FirestoreService(db);
          await svc.saveDocument(msg.docPath, msg.data);
          this.panel.webview.postMessage({ type: "saveResult", success: true });
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.panel.webview.postMessage({ type: "error", message });
    }
  }

  private getHtml(connectionName: string, resourceId: string, panelType: string): string {
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
    window.__PANEL_TYPE__ = "${panelType}";
    window.__INITIAL_DATA__ = ${JSON.stringify({ connectionName, collectionPath: resourceId, docPath: resourceId })};
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
