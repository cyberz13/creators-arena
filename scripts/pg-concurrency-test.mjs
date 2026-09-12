/**
 * Multi-process concurrency proof against a REAL PostgreSQL (never production).
 *
 * Each step spawns several worker processes that hit the same database at the
 * same moment through their own connections, then the parent checks the
 * invariants directly in SQL:
 *   - concurrent finalization → exactly one claim, one payout set, no
 *     duplicate notifications;
 *   - concurrent review of the same click → counters move exactly once;
 *   - concurrent payout transitions → exactly one wins per step; paid is final;
 *   - concurrent clicks on one campaign + IP → counters equal the click log,
 *     device-cap fairness holds, no leaked qualified duplicates;
 *   - (second review) concurrent auto-resolution of held duplicate clicks →
 *     exactly one qualifies; the same challenge nonce replayed from many
 *     processes → one click; disabling a winner while payouts race → money
 *     never moves to an ineligible beneficiary; keyed transactions replayed
 *     concurrently apply once; a connection killed mid-transaction surfaces
 *     as "uncertain" (no key) or is replayed exactly once (with key).
 *
 * Usage (local docker, see PRODUCTION_CHECKLIST.md):
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5433/creators_arena_test \
 *     node scripts/pg-concurrency-test.mjs
 * Refuses any host that does not look like a local/test database.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import bcrypt from "bcryptjs";

process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const url = process.env.TEST_DATABASE_URL ?? "";
if (!url) { console.error("set TEST_DATABASE_URL (a local/test PostgreSQL)"); process.exit(2); }
const host = new URL(url).hostname;
if (!/^(localhost|127\.0\.0\.1|::1|postgres|db)$/.test(host) && !/test/i.test(host)) {
  console.error("refusing: TEST_DATABASE_URL host does not look like a local/test database: " + host);
  process.exit(2);
}
const ssl = /localhost|127\.0\.0\.1/.test(host) ? false : "require";
const sql = postgres(url, { ssl, max: 2, prepare: false });

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) failures += 1; };

function runWorker(scenario, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/lib/pg-worker.ts", scenario, JSON.stringify(args)], {
      env: {
        ...process.env,
        DATABASE_URL: url,
        NODE_ENV: "test",
        SESSION_SECRET: "test-session-secret-" + "x".repeat(24),
        CHALLENGE_SECRET: "test-challenge-secret-" + "y".repeat(24),
        IP_HASH_SALT: "test-ip-salt-000000",
        NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("exit", (code) => {
      const line = out.trim().split("\n").pop() ?? "";
      try { resolve({ code, ...JSON.parse(line) }); } catch { resolve({ code, error: (err || out).slice(-500) }); }
    });
  });
}

async function resetSchema() {
  // Fresh schema every run (test database only — guarded above).
  await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  const schema = fs.readFileSync("src/lib/schema.pg.sql", "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  for (const stmt of schema.split(";").map((s) => s.trim()).filter(Boolean)) await sql.unsafe(stmt);
  await sql.unsafe("INSERT INTO categories (id, name_ar, name_en, sort, active) VALUES ('general','عام','General',0,1) ON CONFLICT DO NOTHING");
  await sql.unsafe("INSERT INTO settings (key, value) VALUES ('ip_intel_enabled','0') ON CONFLICT (key) DO UPDATE SET value = '0'");
}

async function fixtures(participants) {
  const now = Date.now();
  const adminId = randomUUID();
  await sql.unsafe("INSERT INTO users (id, email, password_hash, role, status, created_at) VALUES ($1,$2,$3,'admin','active',$4)", [adminId, `admin-${adminId}@t.test`, bcrypt.hashSync("x", 4), now]);
  const campaignId = randomUUID();
  await sql.unsafe(`INSERT INTO campaigns (id, title, description, requirements, store_name, store_url, status, start_at, end_at, prize_total, winners_count, created_by, created_at, launched_at)
    VALUES ($1,'t','','','s','https://store.example.test/','active',$2,$3,750,2,$4,$2,$2)`, [campaignId, now - 1000, now + 86_400_000, adminId]);
  await sql.unsafe("INSERT INTO prizes (id, campaign_id, rank, amount) VALUES ($1,$2,1,500),($3,$2,2,250)", [randomUUID(), campaignId, randomUUID()]);
  const links = [];
  for (let i = 0; i < participants; i++) {
    const uid = randomUUID();
    await sql.unsafe("INSERT INTO users (id, email, password_hash, role, status, created_at) VALUES ($1,$2,'x','creator','active',$3)", [uid, `c-${uid}@t.test`, now]);
    await sql.unsafe("INSERT INTO creator_profiles (user_id, name, username, followers_count, category_id, created_at) VALUES ($1,'c',$2,1,'general',$3)", [uid, "u" + uid.slice(0, 8), now]);
    const pid = randomUUID();
    await sql.unsafe("INSERT INTO campaign_participants (id, campaign_id, user_id, joined_at) VALUES ($1,$2,$3,$4)", [pid, campaignId, uid, now]);
    const code = "C" + uid.replace(/-/g, "").slice(0, 6);
    await sql.unsafe("INSERT INTO tracking_links (id, code, campaign_id, participant_id, user_id, created_at) VALUES ($1,$2,$3,$4,$5,$6)", [randomUUID(), code, campaignId, pid, uid, now]);
    links.push({ uid, pid, code });
  }
  return { adminId, campaignId, links };
}

const one = async (q, params = []) => (await sql.unsafe(q, params))[0];

try {
  console.log("target: " + host + " (test database)");
  await resetSchema();

  // ---- Scenario A: concurrent clicks on one campaign from one IP (8 processes × 3 clicks)
  {
    const { campaignId, links } = await fixtures(1);
    const results = await Promise.all(Array.from({ length: 8 }, (_, w) => runWorker("clicks", { code: links[0].code, ipHash: "shared-nat", worker: "w" + w, count: 3 })));
    const errors = results.filter((r) => r.error);
    check(errors.length === 0, "A: all click workers completed" + (errors[0] ? " — " + errors[0].error : ""));
    const p = await one("SELECT qualified_count, rejected_count, pending_count, total_clicks FROM campaign_participants WHERE campaign_id = $1", [campaignId]);
    const log = await one("SELECT COUNT(*)::int AS total, SUM((status='qualified')::int)::int AS q, SUM((status='rejected')::int)::int AS r, SUM((status='pending_review')::int)::int AS pe FROM clicks WHERE campaign_id = $1", [campaignId]);
    check(Number(p.total_clicks) === log.total && Number(p.qualified_count) === log.q && Number(p.rejected_count) === log.r && Number(p.pending_count) === log.pe,
      `A: counters equal the click log (total=${log.total} q=${log.q} r=${log.r} pending=${log.pe})`);
    const devicesQualified = await one("SELECT COUNT(DISTINCT device_hash)::int AS n FROM clicks WHERE campaign_id = $1 AND status='qualified'", [campaignId]);
    check(devicesQualified.n <= 5, `A: CGNAT device cap respected under concurrency (qualified devices=${devicesQualified.n} ≤ 5)`);
    check(log.total === 24, `A: every click recorded exactly once (${log.total}/24)`);
  }

  // ---- Scenario B: concurrent finalization (4 processes)
  {
    const { adminId, campaignId, links } = await fixtures(3);
    await Promise.all(links.map((l, i) => runWorker("clicks", { code: l.code, ipHash: "ip-" + i, worker: "b" + i, count: 1 })));
    const results = await Promise.all(Array.from({ length: 4 }, () => runWorker("finalize", { campaignId })));
    const claimed = results.filter((r) => r.claimed === true).length;
    check(claimed === 1, `B: exactly one finalization claim (${claimed}/4)`);
    const payouts = await one("SELECT COUNT(*)::int AS n FROM payouts WHERE campaign_id = $1", [campaignId]);
    check(payouts.n === 2, `B: one payout per prize (${payouts.n})`);
    const notes = await one("SELECT COUNT(*)::int AS n FROM notifications WHERE campaign_id = $1 AND type = 'campaign_ended'", [campaignId]);
    check(notes.n === 3, `B: one ended-notification per participant, no duplicates (${notes.n}/3)`);
    const c = await one("SELECT status, results_status FROM campaigns WHERE id = $1", [campaignId]);
    check(c.status === "ended" && c.results_status === "provisional", "B: campaign ended with provisional results");

    // ---- Scenario C: concurrent confirm + concurrent review of one pending click
    const pendingClick = await one("SELECT id FROM clicks WHERE campaign_id = $1 LIMIT 1", [campaignId]);
    await sql.unsafe("UPDATE clicks SET status = 'pending_review', reject_reason = 'missing_sec_fetch' WHERE id = $1", [pendingClick.id]);
    await sql.unsafe("UPDATE campaign_participants SET qualified_count = qualified_count - 1, pending_count = pending_count + 1 WHERE id = (SELECT participant_id FROM tracking_links WHERE id = (SELECT tracking_link_id FROM clicks WHERE id = $1))", [pendingClick.id]);
    const reviews = await Promise.all(Array.from({ length: 4 }, () => runWorker("review", { clickId: pendingClick.id, adminId })));
    const okReviews = reviews.filter((r) => r.ok === true).length;
    check(okReviews >= 1, `C: review applied (${okReviews} ok, ${reviews.length - okReviews} no-op/refused)`);
    const after = await one("SELECT p.qualified_count, p.pending_count, p.total_clicks, (SELECT COUNT(*)::int FROM clicks k WHERE k.tracking_link_id = t.id AND k.status='qualified') AS qlog FROM campaign_participants p JOIN tracking_links t ON t.participant_id = p.id WHERE t.id = (SELECT tracking_link_id FROM clicks WHERE id = $1)", [pendingClick.id]);
    check(Number(after.qualified_count) === after.qlog && Number(after.pending_count) === 0, `C: counters moved exactly once (qualified=${after.qualified_count}, log=${after.qlog}, pending=${after.pending_count})`);
    const confirms = await Promise.all(Array.from({ length: 3 }, () => runWorker("confirm", { campaignId, adminId })));
    check(confirms.every((r) => r.ok === true), "C: concurrent confirms are idempotent");
    const won = await one("SELECT COUNT(*)::int AS n FROM notifications WHERE campaign_id = $1 AND type = 'campaign_won'", [campaignId]);
    check(won.n === 2, `C: winner notifications sent once per prize (${won.n}/2)`);

    // ---- Scenario D: concurrent payout transitions
    const payout = await one("SELECT id FROM payouts WHERE campaign_id = $1 AND prize_rank = 1", [campaignId]);
    const approves = await Promise.all(Array.from({ length: 4 }, () => runWorker("payout", { payoutId: payout.id, status: "approved", adminId })));
    check(approves.filter((r) => r.ok === true).length === 1, `D: exactly one 'approved' transition wins (${approves.filter((r) => r.ok).length}/4)`);
    const pays = await Promise.all(Array.from({ length: 4 }, () => runWorker("payout", { payoutId: payout.id, status: "paid", adminId })));
    check(pays.filter((r) => r.ok === true).length === 1, `D: exactly one 'paid' transition wins (${pays.filter((r) => r.ok).length}/4)`);
    const audit = await one("SELECT COUNT(*)::int AS n FROM admin_actions WHERE target_id = $1 AND action IN ('payout_approved','payout_paid')", [payout.id]);
    const paidNotes = await one("SELECT COUNT(*)::int AS n FROM notifications WHERE dedupe_key = $1", ["payout_paid:" + payout.id]);
    check(audit.n === 2 && paidNotes.n === 1, `D: audit rows = 2, paid notification = 1 (audit=${audit.n}, notes=${paidNotes.n})`);
    const final = await one("SELECT status FROM payouts WHERE id = $1", [payout.id]);
    check(final.status === "paid", "D: payout ends paid");
  }

  // ---- Scenario E: concurrent auto-resolution of held duplicates (second review B01/B02)
  {
    await sql.unsafe("INSERT INTO settings (key, value) VALUES ('ip_intel_enabled','1') ON CONFLICT (key) DO UPDATE SET value = '1'");
    const { campaignId, links } = await fixtures(1);
    // 3 held clicks from ONE identity (session/device) + 1 held click without sec-fetch from another identity
    for (const nonce of ["n-e1", "n-e2", "n-e3"]) {
      const r = await runWorker("click-replay", { code: links[0].code, ipHash: "held-ip", sessionId: "same-sess", deviceHash: "same-dev", nonce });
      if (r.error) check(false, "E: click worker failed — " + r.error);
    }
    const held = await sql.unsafe("SELECT id, reject_reason FROM clicks WHERE campaign_id = $1 ORDER BY created_at, id", [campaignId]);
    check(held.length === 3 && held.every((r) => r.reject_reason === "ip_unverified"), `E: 3 clicks held as ip_unverified (${held.map((r) => r.reject_reason).join(",")})`);
    const linkRow = await one("SELECT id FROM tracking_links WHERE code = $1", [links[0].code]);
    await sql.unsafe(
      "INSERT INTO clicks (id, tracking_link_id, campaign_id, user_id, status, reject_reason, ip_hash, session_id, device_hash, user_agent, source, signals, created_at) VALUES ($1,$2,$3,$4,'pending_review','ip_unverified','held-ip','other-sess','other-dev','Mozilla/5.0 (iPhone) Safari','direct',$5,$6)",
      [randomUUID(), linkRow.id, campaignId, links[0].uid, JSON.stringify({ sf: false, wd: 0 }), Date.now()]
    );
    await sql.unsafe("UPDATE campaign_participants SET total_clicks = total_clicks + 1, pending_count = pending_count + 1 WHERE campaign_id = $1", [campaignId]);
    await sql.unsafe("INSERT INTO ip_intel (ip_hash, risky, checked_at) VALUES ('held-ip', 0, $1) ON CONFLICT (ip_hash) DO UPDATE SET risky = 0, checked_at = $1", [Date.now()]);
    const ids = (await sql.unsafe("SELECT id FROM clicks WHERE campaign_id = $1 ORDER BY created_at, id", [campaignId])).map((r) => r.id);
    const orders = [ids, [...ids].reverse(), [ids[1], ids[0], ids[3], ids[2]], ids, [...ids].reverse(), [ids[2], ids[1], ids[0], ids[3]]];
    const results = await Promise.all(orders.map((o) => runWorker("autoresolve", { clickIds: o.join(",") })));
    const errors = results.filter((r) => r.error);
    check(errors.length === 0, "E: all auto-resolve workers completed" + (errors[0] ? " — " + errors[0].error : ""));
    const qualifiedOutcomes = results.flatMap((r) => r.outcomes ?? []).filter((o) => o === "qualified").length;
    const logE = await one("SELECT SUM((status='qualified')::int)::int AS q, SUM((status='rejected')::int)::int AS r, SUM((status='pending_review')::int)::int AS pe, SUM((reject_reason='missing_sec_fetch')::int)::int AS nosf FROM clicks WHERE campaign_id = $1", [campaignId]);
    check(qualifiedOutcomes === 1 && logE.q === 1, `E: exactly one duplicate qualified across 6 racing processes (outcomes=${qualifiedOutcomes}, log=${logE.q})`);
    check(logE.r === 2 && logE.pe === 1 && logE.nosf === 1, `E: other duplicates rejected; the no-sec-fetch click stays pending as missing_sec_fetch (r=${logE.r} pending=${logE.pe} nosf=${logE.nosf})`);
    const pE = await one("SELECT qualified_count, rejected_count, pending_count, total_clicks FROM campaign_participants WHERE campaign_id = $1", [campaignId]);
    check(Number(pE.qualified_count) === 1 && Number(pE.rejected_count) === 2 && Number(pE.pending_count) === 1 && Number(pE.total_clicks) === 4, `E: counters equal the click log after concurrent resolution (q=${pE.qualified_count} r=${pE.rejected_count} p=${pE.pending_count} t=${pE.total_clicks})`);
    const override = await one("SELECT COUNT(*)::int AS n FROM admin_actions WHERE action LIKE 'click_review_%' AND target_id = ANY($1)", [ids]);
    const auto = await one("SELECT COUNT(*)::int AS n FROM admin_actions WHERE action = 'click_auto_qualified' AND target_id = ANY($1)", [ids]);
    check(override.n === 0 && auto.n === 1, `E: approval recorded as a pipeline decision, not an admin override (auto=${auto.n}, override=${override.n})`);
    await sql.unsafe("UPDATE settings SET value = '0' WHERE key = 'ip_intel_enabled'");
  }

  // ---- Scenario F: one challenge nonce replayed from 6 processes → one click (idempotency ledger)
  {
    const { campaignId, links } = await fixtures(1);
    const results = await Promise.all(Array.from({ length: 6 }, () => runWorker("click-replay", { code: links[0].code, ipHash: "replay-ip", sessionId: "replay-s", deviceHash: "replay-d", nonce: "same-nonce" })));
    const errors = results.filter((r) => r.error);
    check(errors.length === 0, "F: all replay workers completed" + (errors[0] ? " — " + errors[0].error : ""));
    check(results.every((r) => r.status === "qualified"), `F: every process got the same answer (${results.map((r) => r.status).join(",")})`);
    const n = await one("SELECT COUNT(*)::int AS n FROM clicks WHERE campaign_id = $1", [campaignId]);
    const pF = await one("SELECT total_clicks, qualified_count FROM campaign_participants WHERE campaign_id = $1", [campaignId]);
    check(n.n === 1 && Number(pF.total_clicks) === 1 && Number(pF.qualified_count) === 1, `F: one click recorded and counted once (clicks=${n.n}, total=${pF.total_clicks}, q=${pF.qualified_count})`);
    const ledger = await one("SELECT COUNT(*)::int AS n FROM tx_ledger WHERE key = 'click:same-nonce'");
    check(ledger.n === 1, "F: one ledger row for the nonce");
  }

  // ---- Scenario G: disabling the winner races with approve/pay
  {
    const { adminId, campaignId, links } = await fixtures(2);
    await runWorker("clicks", { code: links[0].code, ipHash: "g-ip-0", worker: "g0", count: 2 });
    await runWorker("clicks", { code: links[1].code, ipHash: "g-ip-1", worker: "g1", count: 1 });
    await runWorker("finalize", { campaignId });
    await runWorker("confirm", { campaignId, adminId });
    const first = await one("SELECT id, user_id FROM payouts WHERE campaign_id = $1 AND prize_rank = 1", [campaignId]);
    check(first.user_id === links[0].uid, "G: rank-1 payout belongs to the leader before the race");
    const race = await Promise.all([
      runWorker("disable", { userId: links[0].uid, adminId }),
      runWorker("payout", { payoutId: first.id, status: "approved", adminId }),
      runWorker("payout", { payoutId: first.id, status: "approved", adminId }),
      runWorker("payout", { payoutId: first.id, status: "paid", adminId }),
    ]);
    check(race[0].ok === true, "G: disable applied" + (race[0].error ? " — " + race[0].error : ""));
    const rank1 = await one("SELECT id, user_id, status FROM payouts WHERE campaign_id = $1 AND prize_rank = 1", [campaignId]);
    const disabledPaid = await one("SELECT COUNT(*)::int AS n FROM payouts WHERE campaign_id = $1 AND user_id = $2 AND status IN ('approved','paid')", [campaignId, links[0].uid]);
    check(disabledPaid.n === 0, `G: the disabled creator never holds an approved/paid payout (${disabledPaid.n})`);
    check(!!rank1 && rank1.user_id === links[1].uid, `G: rank-1 payout reassigned to the next eligible creator (owner=${rank1?.user_id === links[1].uid ? "next" : "other"}, status=${rank1?.status})`);
    const recomputed = await one("SELECT COUNT(*)::int AS n FROM admin_actions WHERE action = 'results_recomputed' AND target_id = $1", [campaignId]);
    check(recomputed.n === 1, "G: recompute audited once");
  }

  // ---- Scenario H: transaction retry semantics on real connection loss
  {
    await sql.unsafe("INSERT INTO settings (key, value) VALUES ('h-counter','0') ON CONFLICT (key) DO UPDATE SET value = '0'");
    const keyed = await Promise.all(Array.from({ length: 6 }, (_, i) => runWorker("ledger-tx", { key: "h-key-1", counterKey: "h-counter", worker: "h" + i })));
    const errorsH = keyed.filter((r) => r.error);
    check(errorsH.length === 0, "H: keyed workers completed" + (errorsH[0] ? " — " + errorsH[0].error : ""));
    const hv = await one("SELECT value FROM settings WHERE key = 'h-counter'");
    check(hv.value === "1" && keyed.every((r) => r.applied === true), `H: 6 concurrent runs with one idempotency key applied exactly once (counter=${hv.value})`);
    const winner = new Set(keyed.map((r) => r.worker));
    check(winner.size === 1, `H: every process got the stored result of the single execution (workers seen=${[...winner].join(",")})`);

    await sql.unsafe("UPDATE settings SET value = '0' WHERE key = 'h-counter'");
    const lost = await runWorker("uncertain-write", { counterKey: "h-counter" });
    const afterLost = await one("SELECT value FROM settings WHERE key = 'h-counter'");
    check(lost.outcome === "uncertain", `H: connection killed mid-transaction without a key → DbUncertainError, not a silent replay (outcome=${lost.outcome}${lost.error ? " " + lost.error : ""})`);
    check(afterLost.value === "0", `H: the killed transaction did not apply (counter=${afterLost.value})`);
    const lostKeyed = await runWorker("uncertain-write", { counterKey: "h-counter", key: "h-key-2" });
    const afterKeyed = await one("SELECT value FROM settings WHERE key = 'h-counter'");
    // the keyed retry re-runs the same body, which kills its backend again → still not committed, applied at most once
    check(lostKeyed.outcome !== "committed" && Number(afterKeyed.value) <= 1, `H: keyed retry after a lost connection never applies twice (outcome=${lostKeyed.outcome}, counter=${afterKeyed.value})`);
  }
} catch (e) {
  check(false, "run: " + String(e?.message ?? e));
} finally {
  await sql.end();
}
console.log(failures === 0 ? "ALL POSTGRES CONCURRENCY CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
