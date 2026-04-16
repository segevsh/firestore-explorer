import React, { useState, useEffect, useCallback } from "react";
import { useVsCodeMessages } from "../hooks/useVsCodeMessages";
import { TableView } from "./TableView";
import { JsonView } from "./JsonView";
import { Breadcrumb } from "./Breadcrumb";
import type { FirestoreDoc, HostToWebviewMessage } from "../../../src/types";

interface CollectionViewProps {
  connectionName: string;
  initialCollectionPath: string;
}

interface BreadcrumbSegment {
  label: string;
  path: string;
}

export function CollectionView({ connectionName, initialCollectionPath }: CollectionViewProps) {
  const [documents, setDocuments] = useState<FirestoreDoc[]>([]);
  const [viewMode, setViewMode] = useState<"table" | "json">("table");
  const [limit, setLimit] = useState(500);
  const [findDocId, setFindDocId] = useState("");
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
        break;
      }
      case "error": {
        setLoading(false);
        setLoadingMore(false);
        setError(msg.message);
        break;
      }
      case "collections": {
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
    });
  }, [collectionPath, connectionName, limit, postMessage]);

  function extractColumns(docs: FirestoreDoc[]): string[] {
    const colSet = new Set<string>();
    for (const doc of docs) {
      for (const key of Object.keys(doc.data)) {
        colSet.add(key);
      }
    }
    return Array.from(colSet).sort();
  }

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

      <div className="collection-content">
        {loading ? (
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
              postMessage({ type: "fetchDocuments", connectionName, collectionPath, limit });
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

      {!loading && hasMore && (
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

      <div className="status-bar">
        <span className="status-connection">{connectionName}</span>
        {" · "}
        {loading
          ? "Loading…"
          : `${documents.length} document${documents.length !== 1 ? "s" : ""} loaded`}
      </div>
    </div>
  );
}
