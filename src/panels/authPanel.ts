import * as vscode from "vscode";
import * as path from "path";
import type { ConnectionManager } from "../services/connectionManager";
import { AuthService, EmulatorAuthService } from "../services/authService";
import type { AuthListResult, AuthUser } from "../services/authService";

/** Create the right auth service based on connection type. */
function getAuthService(connectionManager: ConnectionManager, connectionName: string): AuthService | EmulatorAuthService {
  const config = connectionManager.getConfig(connectionName);
  if (config.type === "emulator") {
    const projectId = config.projectId ?? `emulator-${config.name}`;
    return new EmulatorAuthService(config.host, config.authPort ?? 9099, projectId);
  }
  return new AuthService(connectionManager.getAuth(connectionName));
}

export class AuthPanel {
  private panel: vscode.WebviewPanel;

  constructor(
    private context: vscode.ExtensionContext,
    private connectionManager: ConnectionManager,
    connectionName: string
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "firestoreAuth",
      `Auth (${connectionName})`,
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

  private async handleMessage(msg: any) {
    try {
      switch (msg.type) {
        case "fetchUsers": {
          const svc = getAuthService(this.connectionManager, msg.connectionName);
          const result = await svc.listUsers(msg.limit, msg.pageToken);
          this.panel.webview.postMessage({
            type: "loadUsers",
            users: result.users,
            pageToken: result.pageToken,
          });
          break;
        }
        case "searchUser": {
          const svc = getAuthService(this.connectionManager, msg.connectionName);
          const user = await svc.searchUser(msg.query);
          this.panel.webview.postMessage({ type: "searchResult", users: [user] });
          break;
        }
        case "openUserDetail": {
          new AuthUserPanel(
            this.context,
            this.connectionManager,
            msg.connectionName,
            msg.uid
          );
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
    window.__PANEL_TYPE__ = "auth";
    window.__INITIAL_DATA__ = ${JSON.stringify({ connectionName })};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

class AuthUserPanel {
  private panel: vscode.WebviewPanel;

  constructor(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    connectionName: string,
    uid: string
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "firestoreAuthUser",
      `User: ${uid}`,
      vscode.ViewColumn.Two,
      { enableScripts: false }
    );

    this.loadUser(connectionManager, connectionName, uid);
  }

  private async loadUser(connectionManager: ConnectionManager, connectionName: string, uid: string) {
    try {
      const svc = getAuthService(connectionManager, connectionName);
      const user = await svc.getUser(uid);
      this.panel.webview.html = this.getUserHtml(connectionName, user);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.panel.webview.html = `<body style="padding:24px;color:var(--vscode-errorForeground)">Failed to load user: ${escapeHtml(message)}</body>`;
    }
  }

  private getUserHtml(connectionName: string, user: any): string {
    const sections: Array<{ title: string; rows: [string, string][] }> = [
      {
        title: "Identity",
        rows: [
          ["UID", user.uid],
          ["Email", user.email ?? "—"],
          ["Display Name", user.displayName ?? "—"],
          ["Phone", user.phoneNumber ?? "—"],
          ["Photo URL", user.photoURL ?? "—"],
        ],
      },
      {
        title: "Status",
        rows: [
          ["Disabled", String(user.disabled)],
          ["Email Verified", String(user.emailVerified)],
        ],
      },
      {
        title: "Timestamps",
        rows: [
          ["Created", user.metadata.creationTime ?? "—"],
          ["Last Sign In", user.metadata.lastSignInTime ?? "—"],
          ["Last Refresh", user.metadata.lastRefreshTime ?? "—"],
          ["Tokens Valid After", user.tokensValidAfterTime ?? "—"],
        ],
      },
    ];

    if (user.providerData && user.providerData.length > 0) {
      sections.push({
        title: "Providers",
        rows: user.providerData.map((p: any) => [
          p.providerId,
          [p.email, p.displayName, p.uid].filter(Boolean).join(" · "),
        ]),
      });
    }

    const sectionsHtml = sections
      .map(
        (s) => `
        <h3>${escapeHtml(s.title)}</h3>
        <table>${s.rows.map(([label, value]) => `<tr><td class="label">${escapeHtml(label)}</td><td class="value">${escapeHtml(value)}</td></tr>`).join("")}</table>`
      )
      .join("");

    let claimsHtml = "";
    if (user.customClaims && Object.keys(user.customClaims).length > 0) {
      claimsHtml = `
        <h3>Custom Claims</h3>
        <pre class="claims-json">${escapeHtml(JSON.stringify(user.customClaims, null, 2))}</pre>`;
    }

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
    h2 { margin: 0 0 4px; font-size: 16px; }
    .connection-badge {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 16px;
    }
    h3 {
      margin: 16px 0 4px;
      font-size: 12px;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
    }
    table { width: 100%; border-collapse: collapse; }
    tr { border-bottom: 1px solid var(--vscode-widget-border); }
    td { padding: 5px 8px; vertical-align: top; }
    .label { font-weight: 600; white-space: nowrap; width: 150px; color: var(--vscode-descriptionForeground); }
    .value { font-family: var(--vscode-editor-font-family); word-break: break-all; }
    .claims-json {
      background: var(--vscode-textCodeBlock-background);
      padding: 8px 12px;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      white-space: pre-wrap;
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <h2>${escapeHtml(user.displayName || user.email || user.uid)}</h2>
  <div class="connection-badge">Connection: ${escapeHtml(connectionName)}</div>
  ${sectionsHtml}
  ${claimsHtml}
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

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
