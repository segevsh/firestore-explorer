import * as vm from "vm";
import * as util from "util";
import * as admin from "firebase-admin";
import type { ConnectionManager } from "./connectionManager";

export interface LogEntry {
  level: "log" | "info" | "warn" | "error" | "debug";
  timestamp: number; // ms since epoch
  message: string;   // pre-formatted string
}

export interface QueryResult {
  /** "collection" = QuerySnapshot, "document" = single DocumentSnapshot, "raw" = other */
  resultType: "collection" | "document" | "raw";
  documents: Array<{ id: string; path: string; data: Record<string, unknown> }>;
  rawOutput?: unknown;
  /** Captured console output from the script execution, plus start/end timing entries. */
  logs: LogEntry[];
}

function formatArgs(args: unknown[]): string {
  return args
    .map((a) =>
      typeof a === "string" ? a : util.inspect(a, { depth: 4, breakLength: 120 })
    )
    .join(" ");
}

function makeConsoleProxy(logs: LogEntry[]): Console {
  const push = (level: LogEntry["level"]) => (...args: unknown[]) => {
    logs.push({ level, timestamp: Date.now(), message: formatArgs(args) });
  };
  // Provide the common methods a user script would reach for.
  const proxy = {
    log: push("log"),
    info: push("info"),
    warn: push("warn"),
    error: push("error"),
    debug: push("debug"),
    trace: push("debug"),
    dir: (obj: unknown) => {
      logs.push({
        level: "log",
        timestamp: Date.now(),
        message: util.inspect(obj, { depth: 4, breakLength: 120 }),
      });
    },
  };
  return proxy as unknown as Console;
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

  const logs: LogEntry[] = [];
  const consoleProxy = makeConsoleProxy(logs);

  // Wrap user code in an async IIFE so `await` works at top level
  const wrapped = `(async () => {\n${code}\n})()`;

  const sandbox = {
    app,
    db: firestore,
    auth,
    admin,
    console: consoleProxy,
    // Allow the script to return results
    __result: undefined as unknown,
  };

  const start = Date.now();
  logs.push({ level: "info", timestamp: start, message: "Script execution started" });

  try {
    const script = new vm.Script(wrapped, { filename: `query-${connectionName}.js` });
    const context = vm.createContext(sandbox);
    const result = await script.runInContext(context);
    const elapsed = Date.now() - start;
    logs.push({
      level: "info",
      timestamp: Date.now(),
      message: `Script execution completed in ${elapsed}ms`,
    });
    const normalized = normalizeResult(result);
    return { ...normalized, logs };
  } catch (err) {
    const elapsed = Date.now() - start;
    const errMsg = err instanceof Error ? err.stack ?? err.message : String(err);
    logs.push({
      level: "error",
      timestamp: Date.now(),
      message: `Script execution failed after ${elapsed}ms: ${errMsg}`,
    });
    return {
      resultType: "raw",
      documents: [],
      rawOutput: errMsg,
      logs,
    };
  }
}

function normalizeResult(result: unknown): Omit<QueryResult, "logs"> {
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
