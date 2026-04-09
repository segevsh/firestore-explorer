import * as fs from "fs";
import * as path from "path";

/**
 * Manages .firestore/queries.config.json — persists the mapping
 * of query file paths to their selected connection name.
 *
 * Format:
 * {
 *   "queries": {
 *     "local-emulator/users.js": "local-emulator",
 *     "reports/daily.js": "prod"
 *   }
 * }
 *
 * Keys are relative to .firestore/queries/ for portability.
 */

interface QueryConfig {
  queries: Record<string, string>;
}

export class QueryConfigService {
  private configPath: string;
  private cache: QueryConfig | null = null;

  constructor(private workspaceRoot: string) {
    this.configPath = path.join(workspaceRoot, ".firestore", "queries.config.json");
  }

  private load(): QueryConfig {
    if (this.cache) return this.cache;
    if (fs.existsSync(this.configPath)) {
      try {
        this.cache = JSON.parse(fs.readFileSync(this.configPath, "utf-8"));
        return this.cache!;
      } catch {
        // Corrupted file — start fresh
      }
    }
    this.cache = { queries: {} };
    return this.cache;
  }

  private save(): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.configPath, JSON.stringify(this.cache, null, 2) + "\n", "utf-8");
  }

  /** Get the relative key for a query file path. */
  private relativeKey(filePath: string): string {
    const queriesDir = path.join(this.workspaceRoot, ".firestore", "queries");
    return path.relative(queriesDir, filePath).replace(/\\/g, "/");
  }

  /** Get the connection name for a query file, or undefined if not set. */
  getConnection(filePath: string): string | undefined {
    const config = this.load();
    return config.queries[this.relativeKey(filePath)];
  }

  /** Set the connection name for a query file. */
  setConnection(filePath: string, connectionName: string): void {
    const config = this.load();
    config.queries[this.relativeKey(filePath)] = connectionName;
    this.save();
  }

  /** Remove mapping for a query file. */
  removeConnection(filePath: string): void {
    const config = this.load();
    delete config.queries[this.relativeKey(filePath)];
    this.save();
  }

  /** Invalidate cache (e.g. after external edits). */
  invalidate(): void {
    this.cache = null;
  }
}
