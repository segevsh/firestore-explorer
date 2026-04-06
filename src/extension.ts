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
import { FirestoreFileSystemProvider } from "./providers/firestoreFileSystemProvider";
import { runQuery } from "./services/queryRunner";
import type { ConnectionConfig } from "./types";

let connectionManager: ConnectionManager;

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

  // Tree providers
  const connectionTreeProvider = new ConnectionTreeProvider(connectionManager, resolveConnection);
  const savedQueriesProvider = new SavedQueriesTreeProvider(workspaceRoot, connectionManager);

  vscode.window.registerTreeDataProvider("firestoreConnections", connectionTreeProvider);
  vscode.window.registerTreeDataProvider("firestoreSavedQueries", savedQueriesProvider);

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
    }),

    vscode.commands.registerCommand("firestoreExplorer.disconnect", async (item: ConnectionTreeItem) => {
      await connectionManager.disconnect(item.connectionState.config.name);
      connectionTreeProvider.refresh();
      savedQueriesProvider.refresh();
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

    vscode.commands.registerCommand("firestoreExplorer.createQueryFolder", async (item?: any) => {
      let connectionName: string | undefined;
      if (item?.connectionName) {
        connectionName = item.connectionName;
      } else {
        const states = connectionManager.getAll();
        if (states.length === 1) {
          connectionName = states[0].config.name;
        } else {
          connectionName = await vscode.window.showQuickPick(
            states.map((s) => s.config.name),
            { placeHolder: "Select a connection" }
          );
        }
      }
      if (!connectionName) return;

      const folderName = await vscode.window.showInputBox({ prompt: "Folder name" });
      if (!folderName) return;

      savedQueriesProvider.ensureQueriesDir(connectionName, folderName);
      savedQueriesProvider.refresh();
    }),

    vscode.commands.registerCommand("firestoreExplorer.createQueryFile", async (item?: any) => {
      let connectionName: string | undefined;
      let subfolder: string | undefined;

      if (item?.connectionName) {
        connectionName = item.connectionName;
      }
      if (item?.folderName) {
        subfolder = item.folderName;
      }

      if (!connectionName) {
        const states = connectionManager.getAll();
        if (states.length === 1) {
          connectionName = states[0].config.name;
        } else {
          connectionName = await vscode.window.showQuickPick(
            states.map((s) => s.config.name),
            { placeHolder: "Select a connection" }
          );
        }
      }
      if (!connectionName) return;

      const queryName = await vscode.window.showInputBox({ prompt: "Query name" });
      if (!queryName) return;

      const dir = savedQueriesProvider.ensureQueriesDir(connectionName, subfolder);
      const filePath = path.join(dir, `${queryName}.js`);

      const template = `// Query for ${connectionName}
// Available globals: app, db, auth, admin
//
// Return a QuerySnapshot, DocumentSnapshot, or any value:
//   return db.collection("users").limit(10).get();
//   return db.doc("users/abc").get();

return db.collection("").limit(10).get();
`;

      fs.writeFileSync(filePath, template, "utf-8");
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc);
      savedQueriesProvider.refresh();
    }),

    vscode.commands.registerCommand("firestoreExplorer.runSavedQuery", async (item?: any) => {
      if (!item?.filePath || !item?.connectionName) {
        vscode.window.showWarningMessage("Run this command from the Saved Queries tree.");
        return;
      }

      const state = connectionManager.getState(item.connectionName);
      if (!state || state.status !== "connected") {
        vscode.window.showWarningMessage(`Not connected to ${item.connectionName}. Connect first.`);
        return;
      }

      try {
        const code = fs.readFileSync(item.filePath, "utf-8");
        const result = await runQuery(code, item.connectionName, connectionManager);

        if (result.documents.length > 0) {
          // Show results in a new untitled JSON document
          const content = JSON.stringify(result.documents, null, 2);
          const doc = await vscode.workspace.openTextDocument({ content, language: "json" });
          await vscode.window.showTextDocument(doc);
        } else if (result.rawOutput !== undefined) {
          const content = typeof result.rawOutput === "string"
            ? result.rawOutput
            : JSON.stringify(result.rawOutput, null, 2);
          const doc = await vscode.workspace.openTextDocument({ content, language: "json" });
          await vscode.window.showTextDocument(doc);
        } else {
          vscode.window.showInformationMessage("Query returned no results.");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Query failed: ${msg}`);
      }
    }),

    vscode.commands.registerCommand("firestoreExplorer.refreshConnections", () => {
      connectionTreeProvider.refresh();
      savedQueriesProvider.refresh();
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
