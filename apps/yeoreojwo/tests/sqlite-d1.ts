import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import type { PlatformDatabase } from '../lib/platform-service.ts';

type Value = string | number | null;

class Statement {
  readonly connection: DatabaseSync;
  readonly sql: string;
  values: Value[] = [];

  constructor(connection: DatabaseSync, sql: string) { this.connection = connection; this.sql = sql; }
  bind(...values: Value[]): Statement { this.values = values; return this; }
  query(): { results: Record<string, unknown>[]; success: boolean; meta: { changes: number } } {
    const statement = this.connection.prepare(this.sql);
    if (/^\s*(SELECT|PRAGMA)\b/iu.test(this.sql)) {
      return { results: statement.all(...this.values) as Record<string, unknown>[], success: true, meta: { changes: 0 } };
    }
    const result = statement.run(...this.values);
    return { results: [], success: true, meta: { changes: Number(result.changes) } };
  }
  async all(): Promise<ReturnType<Statement['query']>> { return this.query(); }
  async run(): Promise<ReturnType<Statement['query']>> { return this.query(); }
  async first<T>(): Promise<T | null> { return (this.query().results[0] as T | undefined) ?? null; }
}

/** Runs the production prepared SQL against SQLite; no in-memory business fake. */
export class SqliteD1 {
  readonly sqlite: DatabaseSync;

  constructor(path = ':memory:') {
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec('PRAGMA foreign_keys = ON;');
  }
  migrate(): void {
    const directory = new URL('../drizzle/', import.meta.url);
    const files = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
    if (!files.length) throw new Error('Run npm run db:generate before the SQL integration tests.');
    for (const file of files) this.sqlite.exec(readFileSync(new URL(file, directory), 'utf8'));
  }
  prepare(sql: string): Statement { return new Statement(this.sqlite, sql); }
  async batch(statements: Statement[]): Promise<ReturnType<Statement['query']>[]> {
    this.sqlite.exec('BEGIN IMMEDIATE;');
    try {
      const result = statements.map((statement) => statement.query());
      this.sqlite.exec('COMMIT;');
      return result;
    } catch (error) {
      this.sqlite.exec('ROLLBACK;');
      throw error;
    }
  }
  asD1(): PlatformDatabase { return this as unknown as PlatformDatabase; }
  close(): void { this.sqlite.close(); }
}
