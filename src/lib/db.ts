/**
 * Data layer with two drivers behind one async API:
 *  - SQLite (node:sqlite)   → local dev + tests (no setup, no native binaries)
 *  - PostgreSQL (postgres.js) → production (Supabase) when DATABASE_URL is set
 *
 * SQL is written once in SQLite/`?` placeholder style; the Postgres driver
 * rewrites placeholders to `$n`. Timestamps are unix epoch ms (BIGINT in PG).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import postgres, { type Sql as PgSql } from "postgres";
import { ensureBootstrap } from "./bootstrap";

// node:sqlite is dev/tests-only; production (Vercel + Supabase) must never load
// it, so resolve the builtin lazily instead of a static import.
type DatabaseSync = import("node:sqlite").DatabaseSync;
function sqliteModule() {
  return process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
}

export type Row = Record<string, unknown>;
export type Param = string | number | null;

interface Driver {
  all(sql: string, params: Param[]): Promise<Row[]>;
  run(sql: string, params: Param[]): Promise<void>;
  begin<T>(fn: () => Promise<T>): Promise<T>;
}

const globalForDb = globalThis as unknown as { __tahaddiDriver?: Driver };

// ---------------- SQLite driver (dev + tests) ----------------

function sqliteDriver(db: DatabaseSync): Driver {
  return {
    async all(sql, params) {
      return db.prepare(sql).all(...params).map((r) => ({ ...(r as Row) }));
    },
    async run(sql, params) {
      db.prepare(sql).run(...params);
    },
    async begin(fn) {
      db.exec("BEGIN");
      try {
        const out = await fn();
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

export function migrate(db: DatabaseSync) {
  const schema = fs.readFileSync(path.join(process.cwd(), "src", "lib", "schema.sql"), "utf8");
  db.exec(schema);
}

function openSqlite(): Driver {
  const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "tahaddi.db");
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new (sqliteModule().DatabaseSync)(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  ensureBootstrap(db);
  return sqliteDriver(db);
}

// ---------------- Postgres driver (Supabase / production) ----------------

const txStore = new AsyncLocalStorage<PgSql>();

function toDollarParams(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

function openPostgres(url: string): Driver {
  const sql = postgres(url, {
    ssl: "require",
    max: Number(process.env.PG_POOL_MAX ?? 1), // Supabase pooler-friendly (serverless)
    prepare: false, // required for Supabase transaction-mode pooling (port 6543)
    // Serverless hygiene: without these, a connection the pooler silently drops
    // hangs the next request on this instance until the platform 504s.
    connect_timeout: 10,
    idle_timeout: 20,
    max_lifetime: 60 * 5,
    types: {
      // BIGINT (timestamps, counts) → number; epoch-ms fits well inside 2^53
      bigint: {
        to: 20,
        from: [20],
        serialize: (v: unknown) => String(v),
        parse: (v: string) => Number(v),
      },
    },
  });
  const client = () => txStore.getStore() ?? sql;
  return {
    async all(text, params) {
      return (await client().unsafe(toDollarParams(text), params as never[])) as unknown as Row[];
    },
    async run(text, params) {
      await client().unsafe(toDollarParams(text), params as never[]);
    },
    async begin(fn) {
      return (await sql.begin((txSql) => txStore.run(txSql as unknown as PgSql, fn))) as never;
    },
  };
}

// ---------------- driver selection + public API ----------------

function getDriver(): Driver {
  if (!globalForDb.__tahaddiDriver) {
    const url = process.env.DATABASE_URL;
    if (url && /^postgres/.test(url)) {
      globalForDb.__tahaddiDriver = openPostgres(url);
    } else if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
      throw new Error("DATABASE_URL (Supabase) is required in production — SQLite has no durable disk on Vercel.");
    } else {
      globalForDb.__tahaddiDriver = openSqlite();
    }
  }
  return globalForDb.__tahaddiDriver;
}

/** Test hook: swap the singleton for an in-memory SQLite database. */
export function setDbForTests(db: DatabaseSync) {
  globalForDb.__tahaddiDriver = sqliteDriver(db);
}

export async function q<T = Row>(sql: string, ...params: Param[]): Promise<T[]> {
  return (await getDriver().all(sql, params)) as T[];
}

export async function one<T = Row>(sql: string, ...params: Param[]): Promise<T | undefined> {
  const rows = await getDriver().all(sql, params);
  return rows[0] as T | undefined;
}

export async function run(sql: string, ...params: Param[]): Promise<void> {
  await getDriver().run(sql, params);
}

export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  return getDriver().begin(fn);
}

export const id = () => crypto.randomUUID();
export const now = () => Date.now();
