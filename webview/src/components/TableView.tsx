import React, { useCallback, useEffect, useRef, useState } from "react";
import type { FirestoreDoc } from "../../../src/types";
import { ColumnPicker } from "./ColumnPicker";

interface TableViewProps {
  documents: FirestoreDoc[];
  visibleColumns: string[];
  allColumns: string[];
  onToggleColumn: (column: string) => void;
  onReorderColumns: (columns: string[]) => void;
  onOpenSubCollection: (docPath: string, subCollection: string) => void;
  onEditDocument: (docPath: string) => void;
  subCollections: Map<string, string[]>;
}

export function TableView({
  documents,
  visibleColumns,
  allColumns,
  onToggleColumn,
  onReorderColumns,
  onOpenSubCollection,
  onEditDocument,
  subCollections,
}: TableViewProps) {
  // cols: ID + visible columns + sub-collections
  const totalCols = visibleColumns.length + 2;
  const totalRows = documents.length;

  const [selectedRow, setSelectedRow] = useState<number>(-1);
  const [selectedCol, setSelectedCol] = useState<number>(-1);
  const tableRef = useRef<HTMLTableElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function renderCell(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function cellTooltip(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === "object") return JSON.stringify(value, null, 2);
    const str = String(value);
    // Only show tooltip if content is long enough to be truncated
    return str.length > 30 ? str : undefined;
  }

  const selectCell = useCallback((row: number, col: number) => {
    setSelectedRow(row);
    setSelectedCol(col);

    // Scroll selected cell into view
    const table = tableRef.current;
    if (!table) return;
    const tr = table.querySelector(`tbody tr:nth-child(${row + 1})`);
    if (!tr) return;
    const td = tr.children[col] as HTMLElement | undefined;
    if (td) {
      td.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, []);

  const handleCellClick = useCallback((row: number, col: number) => {
    selectCell(row, col);
  }, [selectCell]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (selectedRow < 0 || selectedCol < 0) return;

    const isMeta = e.metaKey || e.ctrlKey;

    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        if (isMeta) {
          selectCell(0, selectedCol);
        } else {
          selectCell(Math.max(0, selectedRow - 1), selectedCol);
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        if (isMeta) {
          selectCell(totalRows - 1, selectedCol);
        } else {
          selectCell(Math.min(totalRows - 1, selectedRow + 1), selectedCol);
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (isMeta) {
          // Scroll viewport left by one screen width
          if (scrollRef.current) {
            scrollRef.current.scrollBy({ left: -scrollRef.current.clientWidth, behavior: "smooth" });
          }
        } else {
          selectCell(selectedRow, Math.max(0, selectedCol - 1));
        }
        break;
      case "ArrowRight":
        e.preventDefault();
        if (isMeta) {
          // Scroll viewport right by one screen width
          if (scrollRef.current) {
            scrollRef.current.scrollBy({ left: scrollRef.current.clientWidth, behavior: "smooth" });
          }
        } else {
          selectCell(selectedRow, Math.min(totalCols - 1, selectedCol + 1));
        }
        break;
      case "Home":
        e.preventDefault();
        if (isMeta) {
          // Ctrl+Home: first cell of table
          selectCell(0, 0);
        } else {
          // Home: first cell (ID) of current row
          selectCell(selectedRow, 0);
        }
        break;
      case "End":
        e.preventDefault();
        if (isMeta) {
          // Ctrl+End: last cell of table
          selectCell(totalRows - 1, totalCols - 1);
        } else {
          // End: last cell of current row
          selectCell(selectedRow, totalCols - 1);
        }
        break;
      case "Enter":
        e.preventDefault();
        // Enter on ID column opens the document
        if (selectedCol === 0 && documents[selectedRow]) {
          onEditDocument(documents[selectedRow].path);
        }
        break;
      case "Tab":
        e.preventDefault();
        if (e.shiftKey) {
          // Shift+Tab: previous cell, wrap to previous row
          if (selectedCol > 0) {
            selectCell(selectedRow, selectedCol - 1);
          } else if (selectedRow > 0) {
            selectCell(selectedRow - 1, totalCols - 1);
          }
        } else {
          // Tab: next cell, wrap to next row
          if (selectedCol < totalCols - 1) {
            selectCell(selectedRow, selectedCol + 1);
          } else if (selectedRow < totalRows - 1) {
            selectCell(selectedRow + 1, 0);
          }
        }
        break;
      case "PageDown":
        e.preventDefault();
        selectCell(Math.min(totalRows - 1, selectedRow + 10), selectedCol);
        break;
      case "PageUp":
        e.preventDefault();
        selectCell(Math.max(0, selectedRow - 10), selectedCol);
        break;
      case "Escape":
        setSelectedRow(-1);
        setSelectedCol(-1);
        break;
    }
  }, [selectedRow, selectedCol, totalRows, totalCols, selectCell, documents, onEditDocument]);

  // Clear selection when documents change
  useEffect(() => {
    setSelectedRow(-1);
    setSelectedCol(-1);
  }, [documents]);

  const isSelected = (row: number, col: number) =>
    selectedRow === row && selectedCol === col;

  return (
    <div className="table-view">
      <div className="table-toolbar">
        <ColumnPicker
          allColumns={allColumns}
          visibleColumns={visibleColumns}
          onToggle={onToggleColumn}
          onReorder={onReorderColumns}
        />
      </div>
      <div className="table-scroll" ref={scrollRef}>
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <table
          ref={tableRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          role="grid"
          aria-label="Documents table"
        >
          <thead>
            <tr>
              <th>ID</th>
              {visibleColumns.map((col) => (
                <th key={col}>{col}</th>
              ))}
              <th>Sub-collections</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc, rowIdx) => (
              <tr key={doc.id}>
                <td
                  className={`doc-id${isSelected(rowIdx, 0) ? " cell-selected" : ""}`}
                  title={doc.path}
                  onClick={() => { handleCellClick(rowIdx, 0); onEditDocument(doc.path); }}
                  aria-selected={isSelected(rowIdx, 0)}
                  role="gridcell"
                >
                  {doc.id}
                </td>
                {visibleColumns.map((col, colIdx) => (
                  <td
                    key={col}
                    title={cellTooltip(doc.data[col])}
                    className={isSelected(rowIdx, colIdx + 1) ? "cell-selected" : undefined}
                    onClick={() => handleCellClick(rowIdx, colIdx + 1)}
                    aria-selected={isSelected(rowIdx, colIdx + 1)}
                    role="gridcell"
                  >
                    {renderCell(doc.data[col])}
                  </td>
                ))}
                <td
                  className={isSelected(rowIdx, totalCols - 1) ? "cell-selected" : undefined}
                  onClick={() => handleCellClick(rowIdx, totalCols - 1)}
                  aria-selected={isSelected(rowIdx, totalCols - 1)}
                  role="gridcell"
                >
                  {(subCollections.get(doc.path) ?? []).map((sub) => (
                    <button
                      key={sub}
                      className="sub-collection-badge"
                      onClick={(e) => { e.stopPropagation(); onOpenSubCollection(doc.path, sub); }}
                    >
                      {sub}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
