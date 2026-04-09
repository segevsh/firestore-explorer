import React from "react";
import ReactDOM from "react-dom/client";
import { CollectionView } from "./components/CollectionView";
import { AuthView } from "./components/AuthView";
import { QueryBuilder } from "./components/QueryBuilder";
import { QueryResultsView } from "./components/QueryResultsView";
import "./styles/index.css";

declare global {
  interface Window {
    __PANEL_TYPE__: "collection" | "document" | "queryBuilder" | "auth" | "queryResults";
    __INITIAL_DATA__: Record<string, unknown>;
  }
}

function App() {
  const panelType = window.__PANEL_TYPE__ ?? "collection";
  const data = window.__INITIAL_DATA__ ?? {};

  switch (panelType) {
    case "collection":
      return (
        <CollectionView
          connectionName={data.connectionName as string}
          initialCollectionPath={data.collectionPath as string}
        />
      );
    case "document":
      // Documents now open in VS Code's native JSON editor
      return <div>Document opened in editor</div>;
    case "auth":
      return <AuthView connectionName={data.connectionName as string} />;
    case "queryBuilder":
      return <QueryBuilder connectionName={data.connectionName as string} />;
    case "queryResults":
      return (
        <QueryResultsView
          connectionName={data.connectionName as string}
          resultType={data.resultType as "collection" | "document" | "raw"}
          documents={data.documents as any[] ?? []}
          rawOutput={data.rawOutput}
        />
      );
    default:
      return <div>Unknown panel type</div>;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
