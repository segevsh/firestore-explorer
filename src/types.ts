export interface EmulatorConnection {
  name: string;
  type: "emulator";
  host: string;
  port: number;
  projectId?: string;
  /** Auth emulator port (default: 9099) */
  authPort?: number;
}

export interface ProductionConnection {
  name: string;
  type: "production";
  serviceAccountPath: string;
}

export type ConnectionConfig = EmulatorConnection | ProductionConnection;

export interface ConnectionState {
  config: ConnectionConfig;
  status: "disconnected" | "connected" | "error";
  error?: string;
}

export interface FirestoreDoc {
  id: string;
  path: string;
  data: Record<string, unknown>;
  subCollections?: string[];
  createTime?: string;
  updateTime?: string;
}

export interface QueryClause {
  field: string;
  operator:
    | "=="
    | "!="
    | "<"
    | "<="
    | ">"
    | ">="
    | "array-contains"
    | "array-contains-any"
    | "in"
    | "not-in";
  value: unknown;
}

export type CompoundType = "AND" | "OR";

export interface QueryGroup {
  type: CompoundType;
  clauses: QueryClause[];
}

export interface QueryDef {
  collection: string;
  groups: QueryGroup[];
  orderBy?: { field: string; direction: "asc" | "desc" }[];
  limit?: number;
}

export interface PaginationState {
  limit: number;
  lastDocId?: string;
  hasMore: boolean;
}

// Messages between extension host and webview
export type HostToWebviewMessage =
  | { type: "loadDocuments"; documents: FirestoreDoc[]; hasMore: boolean }
  | { type: "appendDocuments"; documents: FirestoreDoc[]; hasMore: boolean }
  | { type: "loadDocument"; document: FirestoreDoc }
  | { type: "saveResult"; success: boolean; error?: string }
  | { type: "queryResult"; documents: FirestoreDoc[]; hasMore: boolean }
  | { type: "error"; message: string }
  | { type: "collections"; collections: string[] };

export type WebviewToHostMessage =
  | { type: "fetchDocuments"; connectionName: string; collectionPath: string; limit: number }
  | { type: "fetchMore"; connectionName: string; collectionPath: string; limit: number; afterDocId: string }
  | { type: "fetchSubCollections"; connectionName: string; docPath: string }
  | { type: "saveDocument"; connectionName: string; docPath: string; data: Record<string, unknown> }
  | { type: "runQuery"; connectionName: string; query: QueryDef }
  | { type: "openDocument"; connectionName: string; docPath: string }
  | { type: "navigateSubCollection"; connectionName: string; collectionPath: string }
  | { type: "fetchUsers"; connectionName: string; limit: number; pageToken?: string }
  | { type: "searchUser"; connectionName: string; query: string }
  | { type: "openUserDetail"; connectionName: string; uid: string };
