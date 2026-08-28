/**
 * One-time retroactive correction (admin-approved): demote qualified clicks
 * that leaked through the pre-fix race window. Keeps the FIRST qualified per
 * (campaign, ip) and per (campaign, session) inside each 24h window; every
 * later one is re-reviewed to rejected via the audited reviewClick path.
 *
 *   DATABASE_URL=... npx tsx scripts/correct-leaked.ts        (dry run)
 *   DATABASE_URL=... npx tsx scripts/correct-leaked.ts --apply
 */
import { q, one } from "../src/lib/db";
import { reviewClick } from "../src/services/tracking";

const WINDOW = 86_400_000;
const APPLY = process.argv.includes("--apply");

interface Row {
  id: string;
  campaign_id: string;
  ip_hash: string;
  session_id: string;
  created_at: number;
  username: string;
}

function leakedByKey(rows: Row[], key: (r: Row) => string): Set<string> {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = key(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const leaked = new Set<string>();
  for (const list of groups.values()) {
    list.sort((a, b) => a.created_at - b.created_at);
    let lastKept = -Infinity;
    for (const r of list) {
      if (r.created_at - lastKept < WINDOW) leaked.add(r.id);
      else lastKept = r.created_at;
    }
  }
  return leaked;
}

async function main() {
  const rows = await q<Row>(
    `SELECT k.id, k.campaign_id, k.ip_hash, k.session_id, k.created_at, cp.username
     FROM clicks k JOIN creator_profiles cp ON cp.user_id = k.user_id
     WHERE k.status = 'qualified'
     ORDER BY k.created_at`
  );
  const byIp = leakedByKey(rows, (r) => `${r.campaign_id}|${r.ip_hash}`);
  const bySess = leakedByKey(rows, (r) => `${r.campaign_id}|${r.session_id}`);
  const leaked = rows.filter((r) => byIp.has(r.id) || bySess.has(r.id));

  console.log(`إجمالي المؤهلة: ${rows.length} — المتسربة المكتشفة: ${leaked.length}`);
  const perUser = new Map<string, number>();
  for (const r of leaked) perUser.set(r.username, (perUser.get(r.username) ?? 0) + 1);
  for (const [u, c] of perUser) console.log(`  @${u}: -${c}`);

  if (!APPLY) {
    console.log("\n(معاينة فقط — أضف --apply للتنفيذ)");
    process.exit(0);
  }

  const admin = (await one<{ id: string }>("SELECT id FROM users WHERE role = 'admin' LIMIT 1"))!;
  for (const r of leaked) {
    await reviewClick(r.id, "rejected", admin.id, "تصحيح رجعي: تسريب سباق تزامن قبل إصلاح 2026-08-28");
  }
  console.log(`\n✅ صُححت ${leaked.length} زيارة (مسجلة في سجل الإجراءات)`);

  const after = await q<{ username: string; qualified_count: number }>(
    `SELECT cp.username, p.qualified_count
     FROM campaign_participants p JOIN creator_profiles cp ON cp.user_id = p.user_id
     ORDER BY p.qualified_count DESC`
  );
  console.log("العدادات بعد التصحيح:");
  for (const r of after) console.log(`  @${r.username}: ${r.qualified_count}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
