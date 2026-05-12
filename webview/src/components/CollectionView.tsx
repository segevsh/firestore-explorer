import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useVsCodeMessages } from "../hooks/useVsCodeMessages";
import { TableView } from "./TableView";
import { JsonView } from "./JsonView";
import { LogsView } from "./LogsView";
import { Breadcrumb } from "./Breadcrumb";
import type { FirestoreDoc, HostToWebviewMessage, LogEntry, SortSpec } from "../../../src/types";

interface CollectionViewProps {
  connectionName: string;
  initialCollectionPath: string;
  initialLogs?: LogEntry[];
}

interface BreadcrumbSegment {
  label: string;
  path: string;
}

type ViewMode = "table" | "json" | "logs" | "query";

function buildQueryCode(collectionPath: string, orderBy: SortSpec | undefined, limit: number): string {
  const lines = [`return db.collection(${JSON.stringify(collectionPath)})`];
  if (orderBy?.field) {
    lines.push(`  .orderBy(${JSON.stringify(orderBy.field)}, ${JSON.stringify(orderBy.direction)})`);
  }
  lines.push(`  .limit(${limit})`);
  lines.push(`  .get();`);
  return lines.join("\n");
}

function extractColumns(docs: FirestoreDoc[]): string[] {
  const colSet = new Set<string>();
  for (const doc of docs) {
    for (const key of Object.keys(doc.data)) {
      colSet.add(key);
    }
  }
  return Array.from(colSet).sort();
}

export function CollectionView({ connectionName, initialCollectionPath, initialLogs }: CollectionViewProps) {
  const [documents, setDocuments] = useState<FirestoreDoc[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [limit, setLimit] = useState(500);
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs ?? []);
  const [findDocId, setFindDocId] = useState("");
  const [sortFieldInput, setSortFieldInput] = useState("");
  const [appliedSort, setAppliedSort] = useState<SortSpec | undefined>(undefined);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collectionPath, setCollectionPath] = useState(initialCollectionPath);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbSegment[]>([
    { label: initialCollectionPath, path: initialCollectionPath },
  ]);
  const [allColumns, setAllColumns] = useState<string[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [subCollections, setSubCollections] = useState<Map<string, string[]>>(new Map());

  // Query tab state
  const [editedCode, setEditedCode] = useState<string | null>(null);
  const [queryRunning, setQueryRunning] = useState(false);
  const [queryResults, setQueryResults] = useState<FirestoreDoc[] | null>(null);
  const [querySaveStatus, setQuerySaveStatus] = useState<string | null>(null);
  const [queryResultViewMode, setQueryResultViewMode] = useState<"table" | "json">("table");

  const queryCode = useMemo(
    () => buildQueryCode(collectionPath, appliedSort, limit),
    [collectionPath, appliedSort, limit]
  );

  const activeQueryCode = editedCode ?? queryCode;

  const queryResultColumns = useMemo(() => extractColumns(queryResults ?? []), [queryResults]);
  const [queryVisibleColumns, setQueryVisibleColumns] = useState<string[]>([]);

  useEffect(() => {
    setQueryVisibleColumns(queryResultColumns);
  }, [queryResultColumns]);

  const onMessage = useCallback((msg: HostToWebviewMessage) => {
    switch (msg.type) {
      case "loadDocuments": {
        setDocuments(msg.documents);
        setHasMore(msg.hasMore);
        const cols = extractColumns(msg.documents);
        setAllColumns(cols);
        setVisibleColumns(cols);
        setLoading(false);
        setError(null);
        if (msg.logs && msg.logs.length > 0) {
          setLogs((prev) => [...prev, ...msg.logs!]);
        }
        break;
      }
      case "appendDocuments": {
        setDocuments((prev) => {
          const merged = [...prev, ...msg.documents];
          const cols = extractColumns(merged);
          setAllColumns(cols);
          setVisibleColumns((vc) => {
            const newCols = cols.filter((c) => !vc.includes(c));
            return [...vc, ...newCols];
          });
          return merged;
        });
        setHasMore(msg.hasMore);
        setLoadingMore(false);
        if (msg.logs && msg.logs.length > 0) {
          setLogs((prev) => [...prev, ...msg.logs!]);
        }
        break;
      }
      case "logs": {
        setLogs((prev) => [...prev, ...msg.logs]);
        break;
      }
      case "error": {
        setLoading(false);
        setLoadingMore(false);
        setError(msg.message);
        setLogs((prev) => [
          ...prev,
          { level: "error", timestamp: Date.now(), message: msg.message },
        ]);
        break;
      }
      case "collections": {
        break;
      }
      case "queryCodeResult": {
        setQueryRunning(false);
        setQueryResults(msg.documents);
        if (msg.logs && msg.logs.length > 0) {
          setLogs((prev) => [...prev, ...msg.logs!]);
        }
        break;
      }
      case "queryCodeSaved": {
        const fileName = msg.filePath.split(/[\\/]/).pop() ?? "query";
        setQuerySaveStatus(`Saved: ${fileName}`);
        setTimeout(() => setQuerySaveStatus(null), 3000);
        break;
      }
    }
  }, []);

  const { postMessage } = useVsCodeMessages(onMessage);

  useEffect(() => {
    setDocuments([]);
    setSubCollections(new Map());
    setLoading(true);
    setError(null);
    postMessage({
      type: "fetchDocuments",
      connectionName,
      collectionPath,
      limit,
      ...(appliedSort ? { orderBy: appliedSort } : {}),
    });
  }, [collectionPath, connectionName, limit, appliedSort, postMessage]);

  function handleLoadMore() {
    if (documents.length === 0) return;
    const lastDoc = documents[documents.length - 1];
    setLoadingMore(true);
    postMessage({
      type: "fetchMore",
      connectionName,
      collectionPath,
      limit,
      afterDocId: lastDoc.id,
      ...(appliedSort ? { orderBy: appliedSort } : {}),
    });
  }

  function handleOpenSubCollection(docPath: string, subCollection: string) {
    const newPath = `${docPath}/${subCollection}`;
    const docId = docPath.split("/").pop() ?? docPath;
    setCollectionPath(newPath);
    setBreadcrumbs((prev) => [
      ...prev,
      { label: docId, path: docPath },
      { label: subCollection, path: newPath },
    ]);
  }

  function handleBreadcrumbNavigate(path: string) {
    setCollectionPath(path);
    setBreadcrumbs((prev) => {
      const idx = prev.findIndex((s) => s.path === path);
      return prev.slice(0, idx + 1);
    });
  }

  function handleEditDocument(docPath: string) {
    postMessage({ type: "openDocument", connectionName, docPath });
  }

  function handleFindById() {
    const id = findDocId.trim();
    if (!id) return;
    postMessage({
      type: "openDocument",
      connectionName,
      docPath: `${collectionPath}/${id}`,
    });
  }

  function handleToggleColumn(col: string) {
    setVisibleColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  }

  function applySort(field: string, direction: "asc" | "desc") {
    const trimmed = field.trim();
    const next = trimmed ? { field: trimmed, direction } : undefined;
    const sameField = next?.field === appliedSort?.field;
    const sameDir = next?.direction === appliedSort?.direction;
    if (!next && !appliedSort) return;
    if (next && appliedSort && sameField && sameDir) return;
    setAppliedSort(next);
  }

  function handleSortFieldKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      applySort(sortFieldInput, sortDir);
    }
  }

  function handleSortFieldBlur() {
    applySort(sortFieldInput, sortDir);
  }

  function handleSortDir(dir: "asc" | "desc") {
    setSortDir(dir);
    if (sortFieldInput.trim()) {
      applySort(sortFieldInput, dir);
    }
  }

  function handleClearSort() {
    setSortFieldInput("");
    if (appliedSort) setAppliedSort(undefined);
  }

  function handleRunQuery() {
    setQueryRunning(true);
    setQueryResults(null);
    postMessage({ type: "runQueryCode", connectionName, code: activeQueryCode });
  }

  function handleSaveQuery() {
    postMessage({ type: "saveQueryCode", connectionName, collectionPath, code: activeQueryCode });
  }

  function handleResetQueryCode() {
    setEditedCode(null);
    setQueryResults(null);
  }

  const displayDocs = queryResults ?? documents;
  const displayAllCols = queryResults ? queryResultColumns : allColumns;
  const displayVisibleCols = queryResults ? queryVisibleColumns : visibleColumns;

  return (
    <div className="collection-view">
      <Breadcrumb segments={breadcrumbs} onNavigate={handleBreadcrumbNavigate} />

      <div className="collection-toolbar">
        <label>
          Limit:
          <input
            type="number"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) || 500)}
            min={1}
            max={10000}
            className="limit-input"
          />
        </label>
        <label className="sort-field">
          Sort:
          <input
            type="text"
            value={sortFieldInput}
            onChange={(e) => setSortFieldInput(e.target.value)}
            onKeyDown={handleSortFieldKey}
            onBlur={handleSortFieldBlur}
            placeholder="field"
            className="sort-field-input"
            list="sort-fields"
          />
          <datalist id="sort-fields">
            {allColumns.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <div className="sort-dir-toggle view-toggle">
          <button
            className={sortDir === "asc" ? "active" : ""}
            onClick={() => handleSortDir("asc")}
            title="Ascending"
          >
            ↑ asc
          </button>
          <button
            className={sortDir === "desc" ? "active" : ""}
            onClick={() => handleSortDir("desc")}
            title="Descending"
          >
            ↓ desc
          </button>
        </div>
        {appliedSort && (
          <button className="sort-clear" onClick={handleClearSort} title="Clear sort">
            clear
          </button>
        )}
        <div className="view-toggle">
          <button
            className={viewMode === "table" ? "active" : ""}
            onClick={() => setViewMode("table")}
          >
            Table
          </button>
          <button
            className={viewMode === "json" ? "active" : ""}
            onClick={() => setViewMode("json")}
          >
            JSON
          </button>
          <button
            className={viewMode === "query" ? "active" : ""}
            onClick={() => setViewMode("query")}
          >
            Query
          </button>
          <button
            className={viewMode === "logs" ? "active" : ""}
            onClick={() => setViewMode("logs")}
          >
            Logs{logs.length ? ` (${logs.length})` : ""}
          </button>
        </div>
        <div className="find-by-id">
          <label>
            Find by ID:
            <input
              type="text"
              value={findDocId}
              onChange={(e) => setFindDocId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleFindById();
              }}
              placeholder="document id"
              className="find-id-input"
            />
          </label>
          <button onClick={handleFindById} disabled={!findDocId.trim()}>
            Run
          </button>
        </div>
      </div>

      <div className={`collection-content${viewMode === "query" ? " collection-content-query" : ""}`}>
        {viewMode === "logs" ? (
          <LogsView logs={logs} />
        ) : viewMode === "query" ? (
          <div className="query-split-view">
            <div className="query-editor-pane">
              <div className="query-editor-toolbar">
                <button
                  className="query-run-btn"
                  onClick={handleRunQuery}
                  disabled={queryRunning}
                  title="Run query (⌘Enter / Ctrl+Enter)"
                >
                  {queryRunning ? "Running…" : "▶ Run"}
                </button>
                <button
                  className="query-save-btn"
                  onClick={handleSaveQuery}
                  title="Save to .firestore/queries/"
                >
                  Save
                </button>
                {editedCode !== null && (
                  <button
                    className="query-reset-btn"
                    onClick={handleResetQueryCode}
                    title="Reset to current view query"
                  >
                    Reset
                  </button>
                )}
                {querySaveStatus && (
                  <span className="query-save-status">{querySaveStatus}</span>
                )}
                <span className="query-editor-hint">⌘Enter to run</span>
              </div>
              <textarea
                className="query-code-editor query-code-editor-split"
                value={activeQueryCode}
                onChange={(e) => setEditedCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleRunQuery();
                  }
                }}
                spellCheck={false}
              />
            </div>
            <div className="query-results-divider" />
            <div className="query-results-pane">
              {queryRunning ? (
                <div className="loading-state">
                  <div className="spinner" />
                  <div className="loading-text">Running query…</div>
                </div>
              ) : (
                <>
                  <div className="query-results-header">
                    <span className="query-results-label">
                      {queryResults !== null
                        ? `${queryResults.length} result${queryResults.length !== 1 ? "s" : ""}`
                        : `${documents.length} document${documents.length !== 1 ? "s" : ""} (current view)`}
                    </span>
                    <div className="view-toggle">
                      <button
                        className={queryResultViewMode === "table" ? "active" : ""}
                        onClick={() => setQueryResultViewMode("table")}
                      >
                        Table
                      </button>
                      <button
                        className={queryResultViewMode === "json" ? "active" : ""}
                        onClick={() => setQueryResultViewMode("json")}
                      >
                        JSON
                      </button>
                    </div>
                  </div>
                  {queryResultViewMode === "table" ? (
                    <TableView
                      documents={displayDocs}
                      visibleColumns={displayVisibleCols}
                      allColumns={displayAllCols}
                      onToggleColumn={queryResults ? (col) => setQueryVisibleColumns((prev) =>
                        prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
                      ) : handleToggleColumn}
                      onReorderColumns={queryResults ? setQueryVisibleColumns : setVisibleColumns}
                      onOpenSubCollection={handleOpenSubCollection}
                      onEditDocument={handleEditDocument}
                      subCollections={subCollections}
                    />
                  ) : (
                    <JsonView documents={displayDocs} />
                  )}
                </>
              )}
            </div>
          </div>
        ) : loading ? (
          <div className="loading-state">
            <div className="spinner" />
            <div className="loading-text">Loading documents…</div>
          </div>
        ) : error ? (
          <div className="error-state">
            <div className="error-icon">⚠</div>
            <div className="error-text">Failed to load: {error}</div>
            <div className="error-connection">Connection: <strong>{connectionName}</strong></div>
            <button className="error-retry-btn" onClick={() => {
              setLoading(true);
              setError(null);
              postMessage({
                type: "fetchDocuments",
                connectionName,
                collectionPath,
                limit,
                ...(appliedSort ? { orderBy: appliedSort } : {}),
              });
            }}>Retry</button>
          </div>
        ) : documents.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <div className="empty-text">No documents in this collection</div>
            <div className="empty-connection">Connection: <strong>{connectionName}</strong> · Collection: <strong>{collectionPath}</strong></div>
          </div>
        ) : viewMode === "table" ? (
          <TableView
            documents={documents}
            visibleColumns={visibleColumns}
            allColumns={allColumns}
            onToggleColumn={handleToggleColumn}
            onReorderColumns={setVisibleColumns}
            onOpenSubCollection={handleOpenSubCollection}
            onEditDocument={handleEditDocument}
            subCollections={subCollections}
          />
        ) : (
          <JsonView documents={documents} />
        )}
      </div>

      {!loading && hasMore && viewMode !== "query" && (
        <div className="load-more">
          <button onClick={handleLoadMore} disabled={loadingMore}>
            {loadingMore ? (
              <>
                <span className="spinner spinner-inline" /> Loading…
              </>
            ) : (
              "Load More"
            )}
          </button>
        </div>
      )}

      {viewMode !== "query" && (
        <div className="status-bar">
          <span className="status-connection">{connectionName}</span>
          {" · "}
          {loading
            ? "Loading…"
            : `${documents.length} document${documents.length !== 1 ? "s" : ""} loaded`}
          {appliedSort && (
            <>
              {" · "}
              <span>sorted by {appliedSort.field} {appliedSort.direction}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
