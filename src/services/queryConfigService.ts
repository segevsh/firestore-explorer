import * as fs from "fs";
import * as path from "path";

/**
 * Manages .firestore/queries.config.json — persists the mapping
 * of query file paths to their selected connection name.
 *
 * Keys are workspace-relative paths (e.g. `.firestore/queries/users.js`,
 * `src/scripts/cleanup.js`). For backwards compatibility, keys written
 * by older versions (relative to `.firestore/queries/`) are still read.
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

  /** Primary (workspace-relative) and legacy (queries-dir-relative) keys for a file. */
  private keysFor(filePath: string): { primary: string; legacy?: string } {
    const primary = path.relative(this.workspaceRoot, filePath).replace(/\\/g, "/");
    const queriesDir = path.join(this.workspaceRoot, ".firestore", "queries");
    const queryRelative = path.relative(queriesDir, filePath);
    const legacy = queryRelative && !queryRelative.startsWith("..")
      ? queryRelative.replace(/\\/g, "/")
      : undefined;
    return { primary, legacy };
  }

  /** Get the connection name for a query file, or undefined if not set. */
  getConnection(filePath: string): string | undefined {
    const { primary, legacy } = this.keysFor(filePath);
    const config = this.load();
    return config.queries[primary] ?? (legacy ? config.queries[legacy] : undefined);
  }

  /** Set the connection name for a query file. */
  setConnection(filePath: string, connectionName: string): void {
    const { primary, legacy } = this.keysFor(filePath);
    const config = this.load();
    config.queries[primary] = connectionName;
    if (legacy && legacy !== primary) {
      delete config.queries[legacy];
    }
    this.save();
  }

  /** Remove mapping for a query file. */
  removeConnection(filePath: string): void {
    const { primary, legacy } = this.keysFor(filePath);
    const config = this.load();
    delete config.queries[primary];
    if (legacy) delete config.queries[legacy];
    this.save();
  }

  /** Invalidate cache (e.g. after external edits). */
  invalidate(): void {
    this.cache = null;
  }
}
