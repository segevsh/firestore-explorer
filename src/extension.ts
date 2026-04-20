import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";
import { ConnectionManager } from "./services/connectionManager";
import {
  ConnectionTreeProvider,
  ConnectionTreeItem,
  CollectionTreeItem,
} from "./providers/connectionTreeProvider";
import { SavedQueriesTreeProvider } from "./providers/savedQueriesTreeProvider";
import { CollectionPanel } from "./panels/collectionPanel";
import { QueryBuilderPanel } from "./panels/queryBuilderPanel";
import { DocumentEditorPanel } from "./panels/documentEditorPanel";
import { AuthPanel } from "./panels/authPanel";
import { AuthTreeProvider } from "./providers/authTreeProvider";
import { FirestoreFileSystemProvider } from "./providers/firestoreFileSystemProvider";
import { runQuery } from "./services/queryRunner";
import { QueryResultsPanel } from "./panels/queryResultsPanel";
import { QueryConfigService } from "./services/queryConfigService";
import { QueryConnectionCodeLensProvider, hasQueryMarker } from "./providers/queryConnectionCodeLens";
import type { ConnectionConfig } from "./types";

let connectionManager: ConnectionManager;
let queryResultsPanel: QueryResultsPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  connectionManager = new ConnectionManager();
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // Register firestore: virtual file system
  const fsProvider = new FirestoreFileSystemProvider(connectionManager);
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("firestore", fsProvider, {
      isCaseSensitive: true,
    })
  );

  // Resolve relative serviceAccountPath against the workspace root
  function resolveConnection(config: ConnectionConfig): ConnectionConfig {
    if (config.type === "production" && config.serviceAccountPath && workspaceRoot && !path.isAbsolute(config.serviceAccountPath)) {
      return { ...config, serviceAccountPath: path.resolve(workspaceRoot, config.serviceAccountPath) };
    }
    return config;
  }

  // Load connections from settings (register them without connecting)
  function loadConnections() {
    const config = vscode.workspace.getConfiguration("firestoreExplorer");
    return (config.get<ConnectionConfig[]>("connections") ?? []).map(resolveConnection);
  }

  // Query config & CodeLens
  const queryConfig = workspaceRoot ? new QueryConfigService(workspaceRoot) : undefined;

  // Tree providers
  const connectionTreeProvider = new ConnectionTreeProvider(connectionManager, resolveConnection);
  const savedQueriesProvider = new SavedQueriesTreeProvider(workspaceRoot, queryConfig);
  const authTreeProvider = new AuthTreeProvider(connectionManager);

  vscode.window.registerTreeDataProvider("firestoreConnections", connectionTreeProvider);
  vscode.window.registerTreeDataProvider("firestoreSavedQueries", savedQueriesProvider);
  vscode.window.registerTreeDataProvider("firestoreAuth", authTreeProvider);

  // Refresh all tree views whenever connection state changes (connecting,
  // connected, disconnected, error) so the UI reflects progress in real time.
  const unsubscribe = connectionManager.onChange(() => {
    connectionTreeProvider.refresh();
    authTreeProvider.refresh();
  });
  context.subscriptions.push({ dispose: unsubscribe });

  const codeLensProvider = workspaceRoot && queryConfig
    ? new QueryConnectionCodeLensProvider(workspaceRoot, queryConfig, connectionManager)
    : undefined;

  if (codeLensProvider) {
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider({ language: "javascript", scheme: "file" }, codeLensProvider),
      vscode.languages.registerCodeLensProvider({ language: "typescript", scheme: "file" }, codeLensProvider),
    );
  }

  // Publish a context key that reflects whether the active editor is a runnable
  // Firestore query — drives the Cmd+Enter `when` clause for files outside the
  // .firestore/queries folder.
  const updateQueryContext = () => {
    const editor = vscode.window.activeTextEditor;
    let isQuery = false;
    if (editor && editor.document.uri.scheme === "file") {
      const fsPath = editor.document.uri.fsPath;
      if (/\.(js|ts|mjs|cjs)$/i.test(fsPath)) {
        if (workspaceRoot && fsPath.startsWith(path.join(workspaceRoot, ".firestore", "queries"))) {
          isQuery = true;
        } else if (hasQueryMarker(editor.document)) {
          isQuery = true;
        }
      }
    }
    vscode.commands.executeCommand("setContext", "firestoreExplorer.isQueryFile", isQuery);
  };
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateQueryContext),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === vscode.window.activeTextEditor?.document) updateQueryContext();
    }),
  );
  updateQueryContext();

  // Watch .firestore/queries/ for file changes so tree auto-refreshes after rename
  if (workspaceRoot) {
    const queriesPattern = new vscode.RelativePattern(
      path.join(workspaceRoot, ".firestore", "queries"), "**/*"
    );
    const watcher = vscode.workspace.createFileSystemWatcher(queriesPattern);
    watcher.onDidCreate(() => { queryConfig?.invalidate(); savedQueriesProvider.refresh(); codeLensProvider?.refresh(); });
    watcher.onDidDelete(() => { queryConfig?.invalidate(); savedQueriesProvider.refresh(); codeLensProvider?.refresh(); });
    watcher.onDidChange(() => { queryConfig?.invalidate(); savedQueriesProvider.refresh(); codeLensProvider?.refresh(); });
    context.subscriptions.push(watcher);
  }

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("firestoreExplorer.addConnection", async () => {
      const type = await vscode.window.showQuickPick(["emulator", "production"], {
        placeHolder: "Connection type",
      });
      if (!type) return;

      const name = await vscode.window.showInputBox({ prompt: "Connection name" });
      if (!name) return;

      let config: ConnectionConfig;

      if (type === "emulator") {
        const host = await vscode.window.showInputBox({
          prompt: "Emulator host",
          value: "localhost",
        });
        if (!host) return;
        const portStr = await vscode.window.showInputBox({
          prompt: "Emulator port",
          value: "8080",
        });
        if (!portStr) return;
        const projectId = await vscode.window.showInputBox({
          prompt: "Firebase project ID (leave empty for auto-generated)",
        });
        config = { name, type: "emulator", host, port: parseInt(portStr, 10), ...(projectId ? { projectId } : {}) };
      } else {
        const serviceAccountPath = await vscode.window.showInputBox({
          prompt: "Path to service account JSON",
        });
        if (!serviceAccountPath) return;
        config = { name, type: "production", serviceAccountPath };
      }

      // Save to settings
      const vsConfig = vscode.workspace.getConfiguration("firestoreExplorer");
      const connections = vsConfig.get<ConnectionConfig[]>("connections") ?? [];
      connections.push(config);
      await vsConfig.update("connections", connections, vscode.ConfigurationTarget.Workspace);

      // Register without connecting — user connects on expand
      connectionManager.register(resolveConnection(config));
      connectionTreeProvider.refresh();
      savedQueriesProvider.refresh();
      authTreeProvider.refresh();
    }),

    vscode.commands.registerCommand("firestoreExplorer.connect", async (item: ConnectionTreeItem) => {
      try {
        await connectionManager.connect(resolveConnection(item.connectionState.config));
        vscode.window.showInformationMessage(`Connected to ${item.connectionState.config.name}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Connection failed: ${msg}`);
      }
      connectionTreeProvider.refresh();
      savedQueriesProvider.refresh();
      authTreeProvider.refresh();
    }),

    vscode.commands.registerCommand("firestoreExplorer.disconnect", async (item: ConnectionTreeItem) => {
      await connectionManager.disconnect(item.connectionState.config.name);
      connectionTreeProvider.refresh();
      savedQueriesProvider.refresh();
      authTreeProvider.refresh();
    }),

    vscode.commands.registerCommand("firestoreExplorer.cancelConnect", (item: ConnectionTreeItem) => {
      connectionManager.cancel(item.connectionState.config.name);
    }),

    vscode.commands.registerCommand("firestoreExplorer.removeConnection", async (item: ConnectionTreeItem) => {
      const name = item.connectionState.config.name;
      await connectionManager.remove(name);

      const vsConfig = vscode.workspace.getConfiguration("firestoreExplorer");
      const connections = (vsConfig.get<ConnectionConfig[]>("connections") ?? []).filter(
        (c) => c.name !== name
      );
      await vsConfig.update("connections", connections, vscode.ConfigurationTarget.Workspace);

      connectionTreeProvider.refresh();
      savedQueriesProvider.refresh();
      authTreeProvider.refresh();
    }),

    vscode.commands.registerCommand(
      "firestoreExplorer.openCollection",
      (connectionName: string, collectionPath: string) => {
        new CollectionPanel(context, connectionManager, fsProvider, connectionName, collectionPath);
      }
    ),

    vscode.commands.registerCommand("firestoreExplorer.searchCollections", async () => {
      const filter = await vscode.window.showInputBox({
        prompt: "Filter collections by name",
        placeHolder: "Type to filter…",
        value: "",
      });
      connectionTreeProvider.setFilter(filter ?? "");
    }),

    vscode.commands.registerCommand("firestoreExplorer.clearSearch", () => {
      connectionTreeProvider.setFilter("");
    }),

    vscode.commands.registerCommand("firestoreExplorer.openQueryBuilder", async () => {
      const states = connectionManager.getAll().filter((s) => s.status === "connected");
      if (states.length === 0) {
        vscode.window.showWarningMessage("No connected databases. Connect first.");
        return;
      }
      let connectionName: string;
      if (states.length === 1) {
        connectionName = states[0].config.name;
      } else {
        const picked = await vscode.window.showQuickPick(
          states.map((s) => s.config.name),
          { placeHolder: "Select a connection" }
        );
        if (!picked) return;
        connectionName = picked;
      }
      new QueryBuilderPanel(context, connectionManager, connectionName, workspaceRoot);
    }),

    vscode.commands.registerCommand("firestoreExplorer.openSavedQuery", async (filePath: string) => {
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc);
    }),

    vscode.commands.registerCommand("firestoreExplorer.selectQueryConnection", async (filePath: string) => {
      if (!queryConfig) return;
      const states = connectionManager.getAll();
      if (states.length === 0) {
        vscode.window.showWarningMessage("No connections configured.");
        return;
      }
      const current = queryConfig.getConnection(filePath);
      const picked = await vscode.window.showQuickPick(
        states.map((s) => ({
          label: s.config.name,
          description: s.status === "connected" ? "connected" : "disconnected",
          picked: s.config.name === current,
        })),
        { placeHolder: "Select connection for this query" }
      );
      if (!picked) return;
      queryConfig.setConnection(filePath, picked.label);
      codeLensProvider?.refresh();
    }),

    vscode.commands.registerCommand("firestoreExplorer.createQueryFolder", async (item?: any) => {
      if (!workspaceRoot) return;

      const parentDir = item?.folderPath
        ?? path.join(workspaceRoot, ".firestore", "queries");
      savedQueriesProvider.ensureQueriesDir(
        path.relative(path.join(workspaceRoot, ".firestore", "queries"), parentDir) || undefined
      );

      // Auto-name: folder-1, folder-2, ...
      let i = 1;
      let folderPath = path.join(parentDir, `folder-${i}`);
      while (fs.existsSync(folderPath)) {
        folderPath = path.join(parentDir, `folder-${++i}`);
      }
      fs.mkdirSync(folderPath, { recursive: true });
      savedQueriesProvider.refresh();
    }),

    vscode.commands.registerCommand("firestoreExplorer.createQueryFile", async (item?: any) => {
      if (!workspaceRoot) return;

      const parentDir = item?.folderPath
        ?? path.join(workspaceRoot, ".firestore", "queries");
      savedQueriesProvider.ensureQueriesDir(
        path.relative(path.join(workspaceRoot, ".firestore", "queries"), parentDir) || undefined
      );

      // Auto-name: query-1.js, query-2.js, ...
      let i = 1;
      let filePath = path.join(parentDir, `query-${i}.js`);
      while (fs.existsSync(filePath)) {
        filePath = path.join(parentDir, `query-${++i}.js`);
      }

      const template = `// Available globals: app, db, auth, admin
//
// Return a QuerySnapshot, DocumentSnapshot, or any value:
//   return db.collection("users").limit(10).get();
//   return db.doc("users/abc").get();

return db.collection("").limit(10).get();
`;
      fs.writeFileSync(filePath, template, "utf-8");

      // Assign connection if only one exists
      const states = connectionManager.getAll();
      if (states.length === 1) {
        queryConfig?.setConnection(filePath, states[0].config.name);
      }

      savedQueriesProvider.refresh();
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc);
    }),

    vscode.commands.registerCommand("firestoreExplorer.renameQuery", async (item?: any) => {
      if (!item?.filePath && !item?.folderPath) return;

      const isFolder = !!item.folderPath;
      const currentPath = isFolder ? item.folderPath : item.filePath;
      const currentName = isFolder ? path.basename(currentPath) : path.basename(currentPath, ".js");

      const newName = await vscode.window.showInputBox({
        prompt: `Rename ${isFolder ? "folder" : "query"}`,
        value: currentName,
        valueSelection: [0, currentName.length],
      });
      if (!newName || newName === currentName) return;

      const newPath = path.join(path.dirname(currentPath), isFolder ? newName : `${newName}.js`);
      fs.renameSync(currentPath, newPath);

      // Update config mapping for files
      if (!isFolder && queryConfig) {
        const conn = queryConfig.getConnection(currentPath);
        if (conn) {
          queryConfig.removeConnection(currentPath);
          queryConfig.setConnection(newPath, conn);
        }
      }

      savedQueriesProvider.refresh();
    }),

    vscode.commands.registerCommand("firestoreExplorer.revealQueryInExplorer", async (item?: any) => {
      const targetPath = item?.filePath ?? item?.folderPath;
      if (targetPath) {
        await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(targetPath));
      }
    }),

    vscode.commands.registerCommand("firestoreExplorer.runSavedQuery", async (item?: any) => {
      let filePath: string | undefined = item?.filePath;
      let connectionName: string | undefined = item?.connectionName;

      // If no filePath, try the active editor
      if (!filePath) {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.uri.scheme === "file" && /\.(js|ts|mjs|cjs)$/i.test(editor.document.fileName)) {
          filePath = editor.document.fileName;
        }
      }
      if (!filePath) {
        vscode.window.showWarningMessage("Open a query file or run from the Saved Queries tree.");
        return;
      }

      // Resolve connection from config if not provided
      if (!connectionName && queryConfig) {
        connectionName = queryConfig.getConnection(filePath);
      }
      if (!connectionName) {
        vscode.window.showWarningMessage("No connection assigned. Click the connection selector above the query.");
        return;
      }

      // Auto-connect if needed
      const state = connectionManager.getState(connectionName);
      if (!state) {
        vscode.window.showWarningMessage(`Connection "${connectionName}" not found.`);
        return;
      }
      if (state.status !== "connected") {
        try {
          await connectionManager.connect(resolveConnection(state.config));
          connectionTreeProvider.refresh();
          authTreeProvider.refresh();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Failed to connect to ${connectionName}: ${msg}`);
          return;
        }
      }

      try {
        const code = fs.readFileSync(filePath, "utf-8");
        const result = await runQuery(code, connectionName, connectionManager);

        // Show results in split panel beside the query editor
        if (queryResultsPanel && !queryResultsPanel.disposed) {
          queryResultsPanel.update(connectionName, result);
        } else {
          queryResultsPanel = new QueryResultsPanel(
            context, connectionManager, fsProvider, connectionName, result
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Query failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand("firestoreExplorer.openAuth", async (connectionName: string) => {
      // Auto-connect if not yet connected
      const state = connectionManager.getState(connectionName);
      if (state && state.status !== "connected") {
        try {
          await connectionManager.connect(resolveConnection(state.config));
          connectionTreeProvider.refresh();
          authTreeProvider.refresh();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Failed to connect to ${connectionName}: ${msg}`);
          return;
        }
      }
      new AuthPanel(context, connectionManager, connectionName);
    }),

    vscode.commands.registerCommand("firestoreExplorer.refreshAuth", () => {
      authTreeProvider.refresh();
    }),

    vscode.commands.registerCommand("firestoreExplorer.refreshConnections", () => {
      connectionTreeProvider.refresh();
      savedQueriesProvider.refresh();
      authTreeProvider.refresh();
    })
  );

  // Register all configured connections (without connecting)
  const connections = loadConnections();
  for (const config of connections) {
    connectionManager.register(config);
  }
  if (connections.length > 0) {
    connectionTreeProvider.refresh();
  }
}

export function deactivate() {
  if (connectionManager) {
    connectionManager.disconnectAll();
  }
}
