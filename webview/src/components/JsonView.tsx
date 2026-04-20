import React, { useState, useCallback, useMemo } from "react";
import type { FirestoreDoc } from "../../../src/types";

interface JsonViewProps {
  documents: FirestoreDoc[];
}

export function JsonView({ documents }: JsonViewProps) {
  const [search, setSearch] = useState("");
  const [collapseLevelInput, setCollapseLevelInput] = useState<string>("");
  const [expandToken, setExpandToken] = useState(0);
  const [collapseToken, setCollapseToken] = useState(0);
  const [copied, setCopied] = useState(false);

  const rootObject = useMemo(() => {
    const obj: Record<string, unknown> = {};
    for (const doc of documents) {
      obj[doc.id] = doc.data;
    }
    return obj;
  }, [documents]);

  const fullJsonText = useMemo(() => {
    try {
      return JSON.stringify(rootObject, null, 2);
    } catch {
      return "";
    }
  }, [rootObject]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fullJsonText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable; fail silently
    }
  }, [fullJsonText]);

  const handleExpandAll = useCallback(() => {
    setCollapseLevelInput("");
    setExpandToken((t) => t + 1);
  }, []);

  const handleCollapseAll = useCallback(() => {
    setCollapseLevelInput("");
    setCollapseToken((t) => t + 1);
  }, []);

  const collapseLevel = useMemo(() => {
    if (collapseLevelInput.trim() === "") return null;
    const n = parseInt(collapseLevelInput, 10);
    if (Number.isNaN(n) || n < 0) return null;
    return n;
  }, [collapseLevelInput]);

  const searchTerm = search.trim().toLowerCase();
  const keys = Object.keys(rootObject);

  // Filter top-level doc entries: keep any doc whose subtree matches
  const visibleKeys = useMemo(() => {
    if (!searchTerm) return keys;
    return keys.filter((k) => {
      if (k.toLowerCase().includes(searchTerm)) return true;
      return subtreeMatches(rootObject[k], searchTerm);
    });
  }, [keys, searchTerm, rootObject]);

  return (
    <div className="json-view">
      <div className="json-toolbar">
        <input
          type="text"
          className="json-search-input"
          placeholder="Search keys or values..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="json-toolbar-actions">
          <button
            type="button"
            className="json-toolbar-btn"
            onClick={handleExpandAll}
            title="Expand all"
          >
            Expand all
          </button>
          <button
            type="button"
            className="json-toolbar-btn"
            onClick={handleCollapseAll}
            title="Collapse all"
          >
            Collapse all
          </button>
          <label className="json-level-label" title="Collapse nodes deeper than this level">
            Level:
            <input
              type="number"
              min={0}
              className="json-level-input"
              value={collapseLevelInput}
              onChange={(e) => setCollapseLevelInput(e.target.value)}
              placeholder=""
            />
          </label>
          <button
            type="button"
            className="json-toolbar-btn json-copy-btn"
            onClick={handleCopy}
            title="Copy full JSON"
          >
            {copied ? "Copied" : "Copy JSON"}
          </button>
        </div>
      </div>

      <div className="json-root">
        {keys.length === 0 ? (
          <span className="json-bracket">{"{}"}</span>
        ) : (
          <JsonObjectRoot
            keys={visibleKeys}
            obj={rootObject}
            searchTerm={searchTerm}
            collapseLevel={collapseLevel}
            expandToken={expandToken}
            collapseToken={collapseToken}
          />
        )}
      </div>
    </div>
  );
}

function subtreeMatches(value: unknown, term: string): boolean {
  if (value === null || value === undefined) {
    return String(value).toLowerCase().includes(term);
  }
  switch (typeof value) {
    case "string":
      return value.toLowerCase().includes(term);
    case "number":
    case "boolean":
      return String(value).toLowerCase().includes(term);
    case "object": {
      if (Array.isArray(value)) {
        return value.some((v) => subtreeMatches(v, term));
      }
      const obj = value as Record<string, unknown>;
      for (const k of Object.keys(obj)) {
        if (k.toLowerCase().includes(term)) return true;
        if (subtreeMatches(obj[k], term)) return true;
      }
      return false;
    }
    default:
      return String(value).toLowerCase().includes(term);
  }
}

interface NodeCommonProps {
  depth: number;
  searchTerm: string;
  collapseLevel: number | null;
  expandToken: number;
  collapseToken: number;
}

function JsonNode({
  value,
  depth,
  searchTerm,
  collapseLevel,
  expandToken,
  collapseToken,
}: { value: unknown } & NodeCommonProps) {
  if (value === null) return <span className="json-null">null</span>;
  if (value === undefined) return <span className="json-null">undefined</span>;

  switch (typeof value) {
    case "string":
      return (
        <span className="json-string">
          "<Highlighted text={value} term={searchTerm} />"
        </span>
      );
    case "number":
      return (
        <span className="json-number">
          <Highlighted text={String(value)} term={searchTerm} />
        </span>
      );
    case "boolean":
      return (
        <span className="json-boolean">
          <Highlighted text={String(value)} term={searchTerm} />
        </span>
      );
    case "object":
      if (Array.isArray(value)) {
        return (
          <JsonArray
            items={value}
            depth={depth}
            searchTerm={searchTerm}
            collapseLevel={collapseLevel}
            expandToken={expandToken}
            collapseToken={collapseToken}
          />
        );
      }
      return (
        <JsonObject
          obj={value as Record<string, unknown>}
          depth={depth}
          searchTerm={searchTerm}
          collapseLevel={collapseLevel}
          expandToken={expandToken}
          collapseToken={collapseToken}
        />
      );
    default:
      return <span>{String(value)}</span>;
  }
}

function Highlighted({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(term);
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="json-search-match">{text.slice(idx, idx + term.length)}</span>
      {text.slice(idx + term.length)}
    </>
  );
}

function useCollapseState(
  depth: number,
  collapseLevel: number | null,
  expandToken: number,
  collapseToken: number,
) {
  // local state initialized based on default rule; reset when tokens change
  const [localCollapsed, setLocalCollapsed] = useState(depth > 2);

  // when expand/collapse all changes, reset local state
  React.useEffect(() => {
    setLocalCollapsed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandToken]);
  React.useEffect(() => {
    setLocalCollapsed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseToken]);

  // compute effective collapsed: if collapseLevel is set, it dictates
  let collapsed = localCollapsed;
  if (collapseLevel !== null) {
    collapsed = depth > collapseLevel;
  }

  const toggle = useCallback(() => {
    // toggling overrides level-based collapse by flipping local state;
    // set local state to opposite of current effective collapsed
    setLocalCollapsed(!collapsed);
  }, [collapsed]);

  return [collapsed, toggle] as const;
}

function JsonObjectRoot({
  keys,
  obj,
  searchTerm,
  collapseLevel,
  expandToken,
  collapseToken,
}: {
  keys: string[];
  obj: Record<string, unknown>;
  searchTerm: string;
  collapseLevel: number | null;
  expandToken: number;
  collapseToken: number;
}) {
  // Root is always expanded (depth 0), but still participates in collapse-level logic.
  // For root: effectively always open; its children use depth=1.
  const allKeys = Object.keys(obj);
  if (allKeys.length === 0) return <span className="json-bracket">{"{}"}</span>;

  return (
    <span>
      <span className="json-bracket">{"{"}</span>
      <div className="json-indent">
        <div className="json-indent-content">
          {keys.map((key, i) => (
            <div className="json-line" key={key}>
              <span className="json-key">
                "<Highlighted text={key} term={searchTerm} />"
              </span>
              <span className="json-colon">: </span>
              <JsonNode
                value={obj[key]}
                depth={1}
                searchTerm={searchTerm}
                collapseLevel={collapseLevel}
                expandToken={expandToken}
                collapseToken={collapseToken}
              />
              {i < keys.length - 1 && <span className="json-comma">,</span>}
            </div>
          ))}
        </div>
      </div>
      <span className="json-bracket">{"}"}</span>
    </span>
  );
}

function JsonObject({
  obj,
  depth,
  searchTerm,
  collapseLevel,
  expandToken,
  collapseToken,
}: { obj: Record<string, unknown> } & NodeCommonProps) {
  const keys = Object.keys(obj);
  const [collapsed, toggle] = useCollapseState(depth, collapseLevel, expandToken, collapseToken);

  if (keys.length === 0) {
    return <span className="json-bracket">{"{}"}</span>;
  }

  if (collapsed) {
    return (
      <span className="json-collapsed" onClick={toggle} role="button" tabIndex={0}>
        <span className="json-toggle-arrow-inline">▶</span>
        <span className="json-bracket">{"{"}</span>
        <span className="json-collapsed-hint">
          {keys.length} {keys.length === 1 ? "key" : "keys"}
        </span>
        <span className="json-bracket">{"}"}</span>
      </span>
    );
  }

  return (
    <span>
      <span className="json-bracket">{"{"}</span>
      <div className="json-indent">
        <button className="json-indent-toggle" onClick={toggle} aria-label="Collapse">
          <span className="json-toggle-arrow">▼</span>
          <span className="json-indent-line" />
        </button>
        <div className="json-indent-content">
          {keys.map((key, i) => (
            <div className="json-line" key={key}>
              <span className="json-key">
                "<Highlighted text={key} term={searchTerm} />"
              </span>
              <span className="json-colon">: </span>
              <JsonNode
                value={obj[key]}
                depth={depth + 1}
                searchTerm={searchTerm}
                collapseLevel={collapseLevel}
                expandToken={expandToken}
                collapseToken={collapseToken}
              />
              {i < keys.length - 1 && <span className="json-comma">,</span>}
            </div>
          ))}
        </div>
      </div>
      <span className="json-bracket">{"}"}</span>
    </span>
  );
}

function JsonArray({
  items,
  depth,
  searchTerm,
  collapseLevel,
  expandToken,
  collapseToken,
}: { items: unknown[] } & NodeCommonProps) {
  const [collapsed, toggle] = useCollapseState(depth, collapseLevel, expandToken, collapseToken);

  if (items.length === 0) {
    return <span className="json-bracket">[]</span>;
  }

  if (collapsed) {
    return (
      <span className="json-collapsed" onClick={toggle} role="button" tabIndex={0}>
        <span className="json-toggle-arrow-inline">▶</span>
        <span className="json-bracket">[</span>
        <span className="json-collapsed-hint">
          {items.length} {items.length === 1 ? "item" : "items"}
        </span>
        <span className="json-bracket">]</span>
      </span>
    );
  }

  return (
    <span>
      <span className="json-bracket">[</span>
      <div className="json-indent">
        <button className="json-indent-toggle" onClick={toggle} aria-label="Collapse">
          <span className="json-toggle-arrow">▼</span>
          <span className="json-indent-line" />
        </button>
        <div className="json-indent-content">
          {items.map((item, i) => (
            <div className="json-line" key={i}>
              <span className="json-array-index">{i}</span>
              <JsonNode
                value={item}
                depth={depth + 1}
                searchTerm={searchTerm}
                collapseLevel={collapseLevel}
                expandToken={expandToken}
                collapseToken={collapseToken}
              />
              {i < items.length - 1 && <span className="json-comma">,</span>}
            </div>
          ))}
        </div>
      </div>
      <span className="json-bracket">]</span>
    </span>
  );
}
