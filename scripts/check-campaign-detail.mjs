// Diagnostic: integrity of one campaign's related rows (PGURL env, TITLE env).
import postgres from "postgres";
import { requireProdAccess } from "./lib/prod-guard.mjs";
const __dbUrl = requireProdAccess({ write: false });
const sql = postgres(__dbUrl, { ssl: "require", max: 1, prepare: false });
const title = process.env.TITLE ?? "regerg";
const [c] = await sql.unsafe("SELECT * FROM campaigns WHERE title = $1 LIMIT 1", [title]);
if (!c) { console.log("campaign not found"); process.exit(0); }
console.log("id=" + c.id, "status=" + c.status, "token=" + (c.report_token ? "yes" : "no"));
console.log("start=" + new Date(Number(c.start_at)).toISOString(), "end=" + new Date(Number(c.end_at)).toISOString());
console.log("prize_total=" + c.prize_total, "winners_count=" + c.winners_count, "store_url=" + c.store_url, "logo=" + c.store_logo_url, "image=" + c.image_url);
const prizes = await sql.unsafe("SELECT rank, amount FROM prizes WHERE campaign_id = $1 ORDER BY rank", [c.id]);
console.log("prizes=" + JSON.stringify(prizes));
const parts = await sql.unsafe(
  `SELECT p.user_id, cp.username, p.qualified_count, p.total_clicks, p.last_qualified_at
   FROM campaign_participants p LEFT JOIN creator_profiles cp ON cp.user_id = p.user_id
   WHERE p.campaign_id = $1 ORDER BY p.qualified_count DESC`, [c.id]);
for (const p of parts) console.log(" participant", p.username ?? "<NO PROFILE>", "q=" + p.qualified_count, "t=" + p.total_clicks, "last=" + p.last_qualified_at);
const links = await sql.unsafe("SELECT COUNT(*) AS c FROM tracking_links WHERE campaign_id = $1", [c.id]);
const daily = await sql.unsafe("SELECT day, clicks, qualified FROM campaign_daily_stats WHERE campaign_id = $1 ORDER BY day", [c.id]);
console.log("links=" + links[0].c, "daily=" + JSON.stringify(daily));
const payouts = await sql.unsafe("SELECT COUNT(*) AS c FROM payouts WHERE campaign_id = $1", [c.id]);
console.log("payouts=" + payouts[0].c);
await sql.end();
