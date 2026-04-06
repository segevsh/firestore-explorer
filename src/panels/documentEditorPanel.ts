import * as vscode from "vscode";
import type { ConnectionManager } from "../services/connectionManager";
import type { FirestoreFileSystemProvider } from "../providers/firestoreFileSystemProvider";
import type { FirestoreDoc } from "../types";

export class DocumentEditorPanel {
  private metadataPanel: vscode.WebviewPanel | undefined;
  private saveListener: vscode.Disposable | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    private connectionManager: ConnectionManager,
    private fsProvider: FirestoreFileSystemProvider,
    connectionName: string,
    docPath: string
  ) {
    this.open(connectionName, docPath);
  }

  private async open(connectionName: string, docPath: string) {
    try {
      const { uri, doc } = await this.fsProvider.loadDocument(connectionName, docPath);

      // Open in VS Code's native JSON editor
      const textDoc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(textDoc, {
        viewColumn: vscode.ViewColumn.One,
        preview: false,
      });

      // Force JSON language mode
      await vscode.languages.setTextDocumentLanguage(textDoc, "json");

      // Show metadata panel beside the editor
      this.showMetadata(connectionName, doc, vscode.ViewColumn.Two);

      // Listen for save (Cmd+S / Ctrl+S) on this document
      this.saveListener = vscode.workspace.onDidSaveTextDocument(async (saved) => {
        if (saved.uri.toString() === uri.toString()) {
          await this.handleSave(uri);
        }
      });

      // Clean up when the text editor closes
      const closeListener = vscode.workspace.onDidCloseTextDocument((closed) => {
        if (closed.uri.toString() === uri.toString()) {
          this.metadataPanel?.dispose();
          this.saveListener?.dispose();
          closeListener.dispose();
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to open document: ${message}`);
    }
  }

  private async handleSave(uri: vscode.Uri) {
    try {
      await this.fsProvider.saveToFirestore(uri);
      vscode.window.showInformationMessage("Document saved to Firestore");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Save failed: ${message}`);
    }
  }

  private showMetadata(connectionName: string, doc: FirestoreDoc, viewColumn: vscode.ViewColumn) {
    const docId = doc.path.split("/").pop() ?? doc.id;

    this.metadataPanel = vscode.window.createWebviewPanel(
      "firestoreDocMetadata",
      `${docId} — info`,
      { viewColumn, preserveFocus: true },
      { enableScripts: false }
    );

    this.metadataPanel.webview.html = this.getMetadataHtml(connectionName, doc);
  }

  private getMetadataHtml(connectionName: string, doc: FirestoreDoc): string {
    const fieldCount = Object.keys(doc.data).length;

    const rows: [string, string][] = [
      ["Connection", connectionName],
      ["Document ID", doc.id],
      ["Full Path", doc.path],
      ["Collection", doc.path.split("/").slice(0, -1).join("/")],
      ["Fields", String(fieldCount)],
    ];

    if (doc.createTime) {
      rows.push(["Created", formatTimestamp(doc.createTime)]);
    }
    if (doc.updateTime) {
      rows.push(["Updated", formatTimestamp(doc.updateTime)]);
    }

    const tableRows = rows
      .map(([label, value]) => `<tr><td class="label">${label}</td><td class="value">${escapeHtml(value)}</td></tr>`)
      .join("\n");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px;
      margin: 0;
    }
    h2 {
      margin: 0 0 12px;
      font-size: 14px;
      color: var(--vscode-foreground);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .icon {
      font-size: 16px;
      opacity: 0.7;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    tr {
      border-bottom: 1px solid var(--vscode-widget-border);
    }
    td {
      padding: 6px 8px;
      vertical-align: top;
    }
    .label {
      font-weight: 600;
      white-space: nowrap;
      width: 120px;
      color: var(--vscode-descriptionForeground);
    }
    .value {
      font-family: var(--vscode-editor-font-family);
      word-break: break-all;
    }
    .hint {
      margin-top: 16px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
  </style>
</head>
<body>
  <h2>Document Info</h2>
  <table>${tableRows}</table>
  <p class="hint">Edit the JSON in the editor on the left. Save with Ctrl+S / Cmd+S to write back to Firestore.</p>
</body>
</html>`;
  }
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
