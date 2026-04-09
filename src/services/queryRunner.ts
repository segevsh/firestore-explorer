import * as vm from "vm";
import * as admin from "firebase-admin";
import type { ConnectionManager } from "./connectionManager";

export interface QueryResult {
  /** "collection" = QuerySnapshot, "document" = single DocumentSnapshot, "raw" = other */
  resultType: "collection" | "document" | "raw";
  documents: Array<{ id: string; path: string; data: Record<string, unknown> }>;
  rawOutput?: unknown;
}

/**
 * Runs a user-authored .js query with predefined globals:
 *   - app:  the firebase-admin App for the connection
 *   - db:   the Firestore instance (app.firestore())
 *   - auth: the Auth instance (app.auth())
 *   - admin: the firebase-admin module
 *
 * The query must export/return a value — either:
 *   - A Firestore QuerySnapshot or DocumentSnapshot
 *   - An array of documents
 *   - Any JSON-serializable value (shown as raw output)
 */
export async function runQuery(
  code: string,
  connectionName: string,
  connectionManager: ConnectionManager
): Promise<QueryResult> {
  const firestore = connectionManager.getFirestore(connectionName);
  const app = connectionManager.getApp(connectionName);

  let auth: admin.auth.Auth | undefined;
  try {
    auth = app.auth();
  } catch {
    // Auth may not be available (e.g. emulator without auth)
  }

  // Wrap user code in an async IIFE so `await` works at top level
  const wrapped = `(async () => {\n${code}\n})()`;

  const sandbox = {
    app,
    db: firestore,
    auth,
    admin,
    console,
    // Allow the script to return results
    __result: undefined as unknown,
  };

  const script = new vm.Script(wrapped, { filename: `query-${connectionName}.js` });
  const context = vm.createContext(sandbox);
  const result = await script.runInContext(context);

  return normalizeResult(result);
}

function normalizeResult(result: unknown): QueryResult {
  // Firestore QuerySnapshot
  if (result && typeof result === "object" && "docs" in result && Array.isArray((result as any).docs)) {
    const docs = (result as any).docs.map((doc: any) => ({
      id: doc.id,
      path: doc.ref?.path ?? doc.id,
      data: typeof doc.data === "function" ? doc.data() : doc.data ?? {},
    }));
    return { resultType: "collection", documents: docs };
  }

  // Single DocumentSnapshot
  if (result && typeof result === "object" && "exists" in result && "ref" in result) {
    const doc = result as any;
    if (doc.exists) {
      return {
        resultType: "document",
        documents: [{
          id: doc.id,
          path: doc.ref?.path ?? doc.id,
          data: typeof doc.data === "function" ? doc.data() : doc.data ?? {},
        }],
      };
    }
    return { resultType: "raw", documents: [], rawOutput: "Document does not exist" };
  }

  // Array of plain objects
  if (Array.isArray(result)) {
    return { resultType: "raw", documents: [], rawOutput: result };
  }

  // Any other value
  return { resultType: "raw", documents: [], rawOutput: result };
}
