import React, { useState, useEffect, useCallback } from "react";
import { useVsCodeMessages } from "../hooks/useVsCodeMessages";
import type { AuthUser } from "./authTypes";

interface AuthViewProps {
  connectionName: string;
}

export function AuthView({ connectionName }: AuthViewProps) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [viewMode, setViewMode] = useState<"table" | "json">("table");
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageToken, setPageToken] = useState<string | undefined>();

  const onMessage = useCallback((msg: any) => {
    switch (msg.type) {
      case "loadUsers": {
        if (loadingMore) {
          setUsers((prev) => [...prev, ...msg.users]);
        } else {
          setUsers(msg.users);
        }
        setPageToken(msg.pageToken);
        setLoading(false);
        setLoadingMore(false);
        setError(null);
        break;
      }
      case "error": {
        setLoading(false);
        setLoadingMore(false);
        setError(msg.message);
        break;
      }
    }
  }, [loadingMore]);

  const { postMessage } = useVsCodeMessages(onMessage);

  useEffect(() => {
    setUsers([]);
    setLoading(true);
    setError(null);
    postMessage({ type: "fetchUsers", connectionName, limit });
  }, [connectionName, limit, postMessage]);

  function handleLoadMore() {
    if (!pageToken) return;
    setLoadingMore(true);
    postMessage({ type: "fetchUsers", connectionName, limit, pageToken });
  }

  function handleOpenUser(uid: string) {
    postMessage({ type: "openUserDetail", connectionName, uid });
  }

  const columns = ["uid", "email", "displayName", "disabled", "emailVerified"];

  return (
    <div className="collection-view">
      <div className="collection-toolbar">
        <label>
          Limit:
          <input
            type="number"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) || 100)}
            min={1}
            max={1000}
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
      </div>

      <div className="collection-content">
        {loading ? (
          <div className="loading-state">
            <div className="spinner" />
            <div className="loading-text">Loading users…</div>
          </div>
        ) : error ? (
          <div className="error-state">
            <div className="error-icon">⚠</div>
            <div className="error-text">Failed to load: {error}</div>
            <div className="error-connection">Connection: <strong>{connectionName}</strong></div>
            <button className="error-retry-btn" onClick={() => {
              setLoading(true);
              setError(null);
              postMessage({ type: "fetchUsers", connectionName, limit });
            }}>Retry</button>
          </div>
        ) : users.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">👤</div>
            <div className="empty-text">No users found</div>
            <div className="empty-connection">Connection: <strong>{connectionName}</strong></div>
          </div>
        ) : viewMode === "table" ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                  <th>Created</th>
                  <th>Last Sign In</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.uid}>
                    <td
                      className="doc-id"
                      title={user.uid}
                      onClick={() => handleOpenUser(user.uid)}
                    >
                      {user.uid}
                    </td>
                    <td title={user.email}>{user.email ?? "—"}</td>
                    <td title={user.displayName}>{user.displayName ?? "—"}</td>
                    <td>{user.disabled ? "Yes" : "No"}</td>
                    <td>{user.emailVerified ? "Yes" : "No"}</td>
                    <td>{user.metadata?.creationTime ?? "—"}</td>
                    <td>{user.metadata?.lastSignInTime ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <pre className="json-view" style={{ whiteSpace: "pre-wrap" }}>
            {JSON.stringify(users, null, 2)}
          </pre>
        )}
      </div>

      {!loading && pageToken && (
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
          : `${users.length} user${users.length !== 1 ? "s" : ""} loaded`}
      </div>
    </div>
  );
}
