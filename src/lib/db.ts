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
  // Additive migrations FIRST: schema.sql's indexes may reference columns that
  // CREATE TABLE IF NOT EXISTS won't add to a pre-existing table.
  const additive: Array<[string, string]> = [
    ["clicks", "device_hash TEXT"],
    ["clicks", "geo_country TEXT"],
    ["clicks", "geo_city TEXT"],
    ["clicks", "signals TEXT"],
    ["campaigns", "report_token TEXT"],
  ];
  for (const [table, col] of additive) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`);
    } catch {
      /* column already exists, or table not created yet (fresh DB) */
    }
  }
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
  const mk = () =>
    postgres(url, {
      ssl: "require",
      max: Number(process.env.PG_POOL_MAX ?? 1), // Supabase pooler-friendly (serverless)
      prepare: false, // required for Supabase transaction-mode pooling (port 6543)
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
  let sql = mk();

  // Serverless instances get frozen between requests; a pooled connection the
  // pooler dropped meanwhile makes the next query hang forever. Cap every
  // operation, and on the first failure rebuild the client and retry once.
  const OP_TIMEOUT_MS = 5000;
  const TX_TIMEOUT_MS = 15000; // whole-transaction budget (finalization loops etc.)

  function capped<T>(p: Promise<T>, ms = OP_TIMEOUT_MS): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("pg_op_timeout")), ms);
      p.then(
        (v) => (clearTimeout(t), resolve(v)),
        (e) => (clearTimeout(t), reject(e))
      );
    });
  }

  // Supabase's pooler (Supavisor, transaction mode) hangs on pipelined queries:
  // Promise.all() over one client never resolves, and extra concurrent
  // connections can stall on connect. Serialize EVERY operation through an
  // app-level queue so exactly one query is in flight per instance — measured
  // sequential ops always pass, parallel bursts hang forever.
  let chain: Promise<unknown> = Promise.resolve();
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = chain.then(job, job);
    chain = next.catch(() => {});
    return next;
  }

  async function withRetry<T>(fn: (s: PgSql) => Promise<T>): Promise<T> {
    const inTx = txStore.getStore();
    if (inTx) return fn(inTx); // inside a transaction: already on the tx connection
    return enqueue(async () => {
      try {
        return await capped(fn(sql));
      } catch {
        const stale = sql;
        sql = mk();
        stale.end({ timeout: 1 }).catch(() => {});
        return capped(fn(sql));
      }
    });
  }

  return {
    async all(text, params) {
      return (await withRetry(
        (s) => s.unsafe(toDollarParams(text), params as never[]) as unknown as Promise<Row[]>
      )) as Row[];
    },
    async run(text, params) {
      await withRetry((s) => s.unsafe(toDollarParams(text), params as never[]) as unknown as Promise<unknown>);
    },
    async begin(fn) {
      // Transactions go through the same queue — a tx pins the sole connection,
      // so a concurrent standalone query would otherwise interleave (pipeline).
      return enqueue(() => beginInner(fn)) as Promise<never>;
    },
  };

  async function beginInner<T>(fn: () => Promise<T>): Promise<T> {
    // Retry the whole transaction once on connection failure (implicit rollback).
    const attempt = () =>
      capped(sql.begin((txSql) => txStore.run(txSql as unknown as PgSql, fn)) as Promise<T>, TX_TIMEOUT_MS);
    try {
      return await attempt();
    } catch (e) {
      const code = (e as { code?: string }).code;
      const retriable =
        (e instanceof Error && e.message === "pg_op_timeout") ||
        code === "CONNECTION_CLOSED" ||
        code === "CONNECT_TIMEOUT";
      if (!retriable) {
        throw e; // domain/SQL error — retrying would just repeat it
      }
      const stale = sql;
      sql = mk();
      stale.end({ timeout: 1 }).catch(() => {});
      return attempt();
    }
  }
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

/**
 * Serialize concurrent transactions contending on the same logical key
 * (e.g. campaign+ip for click dedup). Postgres: advisory xact lock —
 * released automatically at commit/rollback. SQLite dev: no-op, its
 * single connection already serializes transactions.
 */
export async function txSerializeOn(key: string): Promise<void> {
  if (process.env.DATABASE_URL && /^postgres/.test(process.env.DATABASE_URL)) {
    await run("SELECT pg_advisory_xact_lock(hashtext(?))", key);
  }
}

export const id = () => crypto.randomUUID();
export const now = () => Date.now();
