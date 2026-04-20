import React, { useState, useCallback, useMemo } from "react";
import { useVsCodeMessages } from "../hooks/useVsCodeMessages";
import { TableView } from "./TableView";
import { JsonView } from "./JsonView";
import { LogsView } from "./LogsView";
import type { FirestoreDoc, LogEntry } from "../../../src/types";

interface QueryResultsViewProps {
  connectionName: string;
  resultType: "collection" | "document" | "raw";
  documents: FirestoreDoc[];
  rawOutput?: unknown;
  logs?: LogEntry[];
}

function extractColumns(docs: FirestoreDoc[]): string[] {
  const colSet = new Set<string>();
  for (const doc of docs) {
    for (const key of Object.keys(doc.data)) {
      colSet.add(key);
    }
  }
  return Array.from(colSet);
}

export function QueryResultsView({ connectionName, resultType, documents, rawOutput, logs }: QueryResultsViewProps) {
  const [viewMode, setViewMode] = useState<"table" | "json" | "logs">("table");
  const effectiveLogs = logs ?? [];

  const columns = useMemo(() => extractColumns(documents), [documents]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(columns);

  // Update visible columns when documents change
  React.useEffect(() => {
    setVisibleColumns(extractColumns(documents));
  }, [documents]);

  const onMessage = useCallback(() => {}, []);
  const { postMessage } = useVsCodeMessages(onMessage);

  function handleOpenDocument(docPath: string) {
    postMessage({ type: "openDocument", connectionName, docPath });
  }

  // Raw output (not a snapshot)
  if (resultType === "raw") {
    const content = rawOutput === undefined
      ? "No results"
      : typeof rawOutput === "string"
        ? rawOutput
        : JSON.stringify(rawOutput, null, 2);
    return (
      <div className="collection-view">
        <div className="collection-toolbar">
          <div className="view-toggle">
            <button className={viewMode !== "logs" ? "active" : ""} onClick={() => setViewMode("table")}>
              Output
            </button>
            <button className={viewMode === "logs" ? "active" : ""} onClick={() => setViewMode("logs")}>
              Logs{effectiveLogs.length ? ` (${effectiveLogs.length})` : ""}
            </button>
          </div>
        </div>
        <div className="collection-content">
          {viewMode === "logs" ? (
            <LogsView logs={effectiveLogs} />
          ) : (
            <pre className="json-view" style={{ whiteSpace: "pre-wrap" }}>{content}</pre>
          )}
        </div>
      </div>
    );
  }

  // No results
  if (documents.length === 0) {
    return (
      <div className="collection-view">
        <div className="collection-toolbar">
          <div className="view-toggle">
            <button className={viewMode !== "logs" ? "active" : ""} onClick={() => setViewMode("table")}>
              Results
            </button>
            <button className={viewMode === "logs" ? "active" : ""} onClick={() => setViewMode("logs")}>
              Logs{effectiveLogs.length ? ` (${effectiveLogs.length})` : ""}
            </button>
          </div>
        </div>
        <div className="collection-content">
          {viewMode === "logs" ? (
            <LogsView logs={effectiveLogs} />
          ) : (
            <div className="empty-state">
              <div className="empty-icon">📭</div>
              <div className="empty-text">Query returned no results</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const label = resultType === "document"
    ? `1 document`
    : `${documents.length} document${documents.length !== 1 ? "s" : ""}`;

  return (
    <div className="collection-view">
      <div className="collection-toolbar">
        <div className="view-toggle">
          <button className={viewMode === "table" ? "active" : ""} onClick={() => setViewMode("table")}>
            Table
          </button>
          <button className={viewMode === "json" ? "active" : ""} onClick={() => setViewMode("json")}>
            JSON
          </button>
          <button className={viewMode === "logs" ? "active" : ""} onClick={() => setViewMode("logs")}>
            Logs{effectiveLogs.length ? ` (${effectiveLogs.length})` : ""}
          </button>
        </div>
      </div>

      <div className="collection-content">
        {viewMode === "table" ? (
          <TableView
            documents={documents}
            allColumns={columns}
            visibleColumns={visibleColumns}
            onToggleColumn={(col) => {
              setVisibleColumns((prev) =>
                prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
              );
            }}
            onReorderColumns={setVisibleColumns}
            onEditDocument={handleOpenDocument}
            onOpenSubCollection={() => {}}
            subCollections={new Map()}
          />
        ) : viewMode === "json" ? (
          <JsonView documents={documents} />
        ) : (
          <LogsView logs={effectiveLogs} />
        )}
      </div>

      <div className="status-bar">
        <span className="status-connection">{connectionName}</span>
        {` · ${label}`}
      </div>
    </div>
  );
}
