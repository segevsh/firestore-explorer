import React, { useState, useCallback } from "react";
import { useVsCodeMessages } from "../hooks/useVsCodeMessages";
import type { AuthUser } from "./authTypes";

interface AuthViewProps {
  connectionName: string;
}

export function AuthView({ connectionName }: AuthViewProps) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [viewMode, setViewMode] = useState<"table" | "json">("table");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageToken, setPageToken] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

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
        setHasSearched(true);
        break;
      }
      case "searchResult": {
        setUsers(msg.users);
        setPageToken(undefined);
        setLoading(false);
        setError(null);
        setHasSearched(true);
        break;
      }
      case "error": {
        setLoading(false);
        setLoadingMore(false);
        setError(msg.message);
        setHasSearched(true);
        break;
      }
    }
  }, [loadingMore]);

  const { postMessage } = useVsCodeMessages(onMessage);

  function handleSearch() {
    const q = searchQuery.trim();
    if (!q) {
      // Empty search = list all users
      setLoading(true);
      setError(null);
      postMessage({ type: "fetchUsers", connectionName, limit: 100 });
      return;
    }
    setLoading(true);
    setError(null);
    postMessage({ type: "searchUser", connectionName, query: q });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      handleSearch();
    }
  }

  function handleLoadMore() {
    if (!pageToken) return;
    setLoadingMore(true);
    postMessage({ type: "fetchUsers", connectionName, limit: 100, pageToken });
  }

  function handleOpenUser(uid: string) {
    postMessage({ type: "openUserDetail", connectionName, uid });
  }

  return (
    <div className="collection-view">
      <div className="auth-search-bar">
        <input
          type="text"
          className="auth-search-input"
          placeholder="Search by email, phone (+...), or UID — leave empty to list all"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button onClick={handleSearch} disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {hasSearched && !loading && !error && users.length > 0 && (
        <div className="collection-toolbar">
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
      )}

      <div className="collection-content">
        {!hasSearched && !loading ? (
          <div className="empty-state">
            <div className="empty-icon">🔍</div>
            <div className="empty-text">Search for users or leave empty to list all</div>
            <div className="empty-connection">Connection: <strong>{connectionName}</strong></div>
          </div>
        ) : loading ? (
          <div className="loading-state">
            <div className="spinner" />
            <div className="loading-text">Loading users…</div>
          </div>
        ) : error ? (
          <div className="error-state">
            <div className="error-icon">⚠</div>
            <div className="error-text">{error}</div>
            <div className="error-connection">Connection: <strong>{connectionName}</strong></div>
            <button className="error-retry-btn" onClick={handleSearch}>Retry</button>
          </div>
        ) : users.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">👤</div>
            <div className="empty-text">No users found</div>
          </div>
        ) : viewMode === "table" ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>UID</th>
                  <th>Email</th>
                  <th>Display Name</th>
                  <th>Phone</th>
                  <th>Disabled</th>
                  <th>Verified</th>
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
                    <td title={user.phoneNumber}>{user.phoneNumber ?? "—"}</td>
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
        {hasSearched && !loading && ` · ${users.length} user${users.length !== 1 ? "s" : ""}`}
      </div>
    </div>
  );
}
