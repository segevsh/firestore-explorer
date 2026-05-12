import React, { useState } from "react";
import type { LogEntry } from "../../../src/types";

interface LogsViewProps {
  logs: LogEntry[];
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button
      className={`log-copy-btn${copied ? " log-copy-btn--copied" : ""}`}
      onClick={handleCopy}
      title="Copy"
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}

export function LogsView({ logs }: LogsViewProps) {
  if (!logs || logs.length === 0) {
    return (
      <div className="log-viewer log-viewer-empty">
        <div className="empty-text">No logs</div>
      </div>
    );
  }

  return (
    <div className="log-viewer">
      {logs.map((entry, i) => (
        <div key={i} className={`log-entry log-level-${entry.level}`}>
          <span className="log-timestamp">{formatTimestamp(entry.timestamp)}</span>
          <span className="log-level">{entry.level.toUpperCase()}</span>
          <pre className="log-message">{entry.message}</pre>
          <CopyButton text={entry.message} />
        </div>
      ))}
    </div>
  );
}
