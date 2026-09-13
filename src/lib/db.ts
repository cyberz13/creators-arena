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

export interface TxOptions {
  /**
   * Stable per-operation key (e.g. the challenge nonce of a click). With a key,
   * the transaction is recorded in `tx_ledger` inside the same transaction:
   * a retry after an UNKNOWN commit outcome replays the stored result instead
   * of executing the writes twice. Without a key, an uncertain outcome is
   * reported as DbUncertainError (never silently re-executed).
   */
  idempotencyKey?: string;
}

interface Driver {
  all(sql: string, params: Param[]): Promise<Row[]>;
  run(sql: string, params: Param[]): Promise<void>;
  /** Like run, but returns the number of affected rows (conditional updates). */
  execute(sql: string, params: Param[]): Promise<number>;
  begin<T>(fn: () => Promise<T>, opts: TxOptions): Promise<T>;
}

/**
 * The database may or may not have applied the operation (the connection
 * dropped or timed out after the statement/COMMIT was sent). Callers must not
 * assume failure; idempotent operations (tx with a key) are replayed safely.
 */
export class DbUncertainError extends Error {
  constructor(cause: unknown) {
    super("database operation outcome unknown (connection lost after send)");
    this.name = "DbUncertainError";
    this.cause = cause;
  }
}

/**
 * Failure classes for the Postgres driver:
 *  - "pre_send": the connection could never be established → nothing reached
 *    the server → always safe to retry;
 *  - "uncertain": lost/timed-out AFTER something may have been sent → safe
 *    only for reads or ledger-keyed transactions;
 *  - "definite": the server answered with an error (SQL/constraint/domain) →
 *    retrying repeats the same error; never retried.
 */
export type PgFailureClass = "pre_send" | "uncertain" | "definite";
export function classifyPgError(e: unknown, sent: boolean): PgFailureClass {
  const code = (e as { code?: string } | null)?.code;
  const msg = e instanceof Error ? e.message : "";
  if (code === "CONNECT_TIMEOUT" || code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN") return "pre_send";
  const lost =
    msg === "pg_op_timeout" ||
    code === "CONNECTION_CLOSED" ||
    code === "CONNECTION_ENDED" ||
    code === "CONNECTION_DESTROYED" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    code === "ETIMEDOUT";
  if (!lost) return "definite";
  return sent ? "uncertain" : "pre_send";
}

const globalForDb = globalThis as unknown as { __tahaddiDriver?: Driver };

// ---------------- SQLite driver (dev + tests) ----------------

function sqliteDriver(db: DatabaseSync): Driver {
  // One connection → transactions must not interleave. Async callers that
  // start a transaction while another is open wait their turn (mirrors the
  // per-instance queue of the Postgres driver).
  let txChain: Promise<unknown> = Promise.resolve();
  return {
    async all(sql, params) {
      return db.prepare(sql).all(...params).map((r) => ({ ...(r as Row) }));
    },
    async run(sql, params) {
      db.prepare(sql).run(...params);
    },
    async execute(sql, params) {
      return Number(db.prepare(sql).run(...params).changes);
    },
    async begin(fn) {
      // In-process engine: a failure is always definite (no lost-COMMIT case).
      const runTx = async () => {
        db.exec("BEGIN");
        try {
          const out = await fn();
          db.exec("COMMIT");
          return out;
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      };
      const next = txChain.then(runTx, runTx);
      txChain = next.catch(() => {});
      return next;
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
    ["campaigns", "results_status TEXT NOT NULL DEFAULT 'open'"],
    ["campaigns", "report_token_expires_at INTEGER"],
    ["campaigns", "report_views INTEGER NOT NULL DEFAULT 0"],
    ["campaigns", "report_last_viewed_at INTEGER"],
    ["users", "participation_status TEXT NOT NULL DEFAULT 'active'"],
    ["users", "approved INTEGER NOT NULL DEFAULT 1"],
    ["campaign_participants", "excluded INTEGER NOT NULL DEFAULT 0"],
    ["campaign_participants", "excluded_reason TEXT"],
    ["notifications", "dedupe_key TEXT"],
    ["users", "email_verified INTEGER NOT NULL DEFAULT 1"],
    ["users", "mfa_enabled INTEGER NOT NULL DEFAULT 0"],
    ["users", "mfa_secret_enc TEXT"],
    ["sessions", "mfa_verified_at INTEGER"],
  ];
  for (const [table, col] of additive) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`);
    } catch {
      /* column already exists, or table not created yet (fresh DB) */
    }
  }
  db.exec(schema);
  // Campaigns finalized before the results lifecycle existed were treated as final.
  db.exec("UPDATE campaigns SET results_status = 'final' WHERE status IN ('ended','cancelled') AND results_status = 'open'");
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
  // TLS is mandatory for any remote host (Supabase). Only a loopback host or an
  // explicit sslmode=disable (local test containers) turns it off.
  const parsed = new URL(url);
  const localHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  const sslOff = localHost || parsed.searchParams.get("sslmode") === "disable";
  const mk = () =>
    postgres(url, {
      ssl: sslOff ? false : "require",
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

  function rebuild() {
    const stale = sql;
    sql = mk();
    stale.end({ timeout: 1 }).catch(() => {});
  }

  /**
   * One statement outside a transaction. A read is retried once on any
   * connection failure (idempotent by nature). A write is retried only when
   * the failure happened before anything was sent; a write whose outcome is
   * unknown surfaces as DbUncertainError instead of being executed twice.
   */
  async function withRetry<T>(fn: (s: PgSql) => Promise<T>, kind: "read" | "write"): Promise<T> {
    const inTx = txStore.getStore();
    if (inTx) return fn(inTx); // inside a transaction: already on the tx connection
    return enqueue(async () => {
      try {
        return await capped(fn(sql));
      } catch (e) {
        // A single statement is "sent" as soon as a connection existed; we
        // cannot tell whether the server processed it before the drop.
        const cls = classifyPgError(e, true);
        if (cls === "definite") throw e;
        rebuild();
        if (cls === "pre_send" || kind === "read") return capped(fn(sql));
        throw new DbUncertainError(e);
      }
    });
  }

  return {
    async all(text, params) {
      return (await withRetry(
        (s) => s.unsafe(toDollarParams(text), params as never[]) as unknown as Promise<Row[]>,
        "read"
      )) as Row[];
    },
    async run(text, params) {
      await withRetry((s) => s.unsafe(toDollarParams(text), params as never[]) as unknown as Promise<unknown>, "write");
    },
    async execute(text, params) {
      const res = (await withRetry(
        (s) => s.unsafe(toDollarParams(text), params as never[]) as unknown as Promise<{ count: number }>,
        "write"
      )) as { count: number };
      return Number(res.count ?? 0);
    },
    async begin(fn, opts) {
      // Transactions go through the same queue — a tx pins the sole connection,
      // so a concurrent standalone query would otherwise interleave (pipeline).
      return enqueue(() => beginInner(fn, opts)) as Promise<never>;
    },
  };

  /**
   * Whole-transaction retry policy:
   *  - failure before BEGIN reached the server ("pre_send") → retry once;
   *  - failure after that (timeout / dropped connection, COMMIT outcome
   *    unknown) → retry once ONLY when the caller supplied an idempotency
   *    key (the ledger makes the replay exact); otherwise DbUncertainError;
   *  - server-side errors → thrown as-is, never retried.
   */
  async function beginInner<T>(fn: () => Promise<T>, opts: TxOptions): Promise<T> {
    let sent = false;
    const attempt = () =>
      capped(
        sql.begin((txSql) => {
          sent = true; // BEGIN was accepted: from here on the server may have state
          return txStore.run(txSql as unknown as PgSql, fn);
        }) as Promise<T>,
        TX_TIMEOUT_MS
      );
    try {
      return await attempt();
    } catch (e) {
      const cls = classifyPgError(e, sent);
      if (cls === "definite") throw e; // domain/SQL error — retrying would just repeat it
      rebuild();
      if (cls === "pre_send" || opts.idempotencyKey) {
        sent = false;
        try {
          return await attempt();
        } catch (e2) {
          // One retry only. A second connection failure is reported honestly
          // as "unknown outcome"; a server error is thrown as-is.
          if (classifyPgError(e2, sent) === "definite") throw e2;
          throw new DbUncertainError(e2);
        }
      }
      throw new DbUncertainError(e);
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

/** Run a statement and return affected rows — the primitive for conditional, idempotent writes. */
export async function execute(sql: string, ...params: Param[]): Promise<number> {
  return getDriver().execute(sql, params);
}

const REPLAY = Symbol("tx_replay");

/**
 * Runs `fn` in a transaction. With `idempotencyKey`, the key is claimed in
 * `tx_ledger` INSIDE the transaction (so it commits or rolls back with the
 * writes) and the JSON result is stored next to it; a second run with the same
 * key — a retry after a lost COMMIT, or a concurrent duplicate — returns the
 * stored result without touching anything (a concurrent claimant blocks on the
 * unique key until the first commits, then sees it). Rows are purged after
 * TX_LEDGER_RETENTION_MS by purgeTxLedger().
 */
export async function tx<T>(fn: () => Promise<T>, opts: TxOptions = {}): Promise<T> {
  const key = opts.idempotencyKey;
  if (!key) return getDriver().begin(fn, opts);
  const out = await getDriver().begin(async () => {
    const claimed = await execute(
      "INSERT INTO tx_ledger (key, result, created_at) VALUES (?, NULL, ?) ON CONFLICT (key) DO NOTHING",
      key,
      Date.now()
    );
    if (claimed !== 1) {
      const row = await one<{ result: string | null }>("SELECT result FROM tx_ledger WHERE key = ?", key);
      return { [REPLAY]: true, value: row?.result == null ? undefined : (JSON.parse(row.result) as T) };
    }
    const value = await fn();
    await run("UPDATE tx_ledger SET result = ? WHERE key = ?", JSON.stringify(value ?? null), key);
    return { [REPLAY]: false, value };
  }, opts);
  return (out as { value: T }).value;
}

export const TX_LEDGER_RETENTION_MS = 24 * 3_600_000;

/** Housekeeping for the idempotency ledger (keys are useless after their retry window). */
export async function purgeTxLedger(nowMs = Date.now()): Promise<void> {
  await run("DELETE FROM tx_ledger WHERE created_at < ?", nowMs - TX_LEDGER_RETENTION_MS);
}

/**
 * Serialize concurrent transactions contending on the same logical key
 * (e.g. campaign+ip for click dedup). Postgres: advisory xact lock —
 * released automatically at commit/rollback. SQLite dev: no-op, its
 * single connection already serializes transactions.
 */
export async function txSerializeOn(key: string, mode: "exclusive" | "shared" = "exclusive"): Promise<void> {
  if (process.env.DATABASE_URL && /^postgres/.test(process.env.DATABASE_URL)) {
    // shared: many click transactions may proceed together; an exclusive
    // holder (review / finalization) waits for them and blocks new ones.
    await run(
      mode === "shared"
        ? "SELECT pg_advisory_xact_lock_shared(hashtext(?))"
        : "SELECT pg_advisory_xact_lock(hashtext(?))",
      key
    );
  }
}

export function isPostgres(): boolean {
  return !!process.env.DATABASE_URL && /^postgres/.test(process.env.DATABASE_URL);
}

/** SQL expression: hour of day (0-23) in Riyadh time for an epoch-ms column — per dialect. */
export function hourOfDayRiyadhExpr(column: string): string {
  return isPostgres()
    ? `(EXTRACT(HOUR FROM (to_timestamp(${column} / 1000.0) AT TIME ZONE 'Asia/Riyadh')))::int` // session-timezone independent
    : `CAST(strftime('%H', (${column} / 1000) + 10800, 'unixepoch') AS INTEGER)`;
}

export const id = () => crypto.randomUUID();
export const now = () => Date.now();
