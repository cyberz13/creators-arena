/** Did any REJECTED click leak into a qualified counter? Direct evidence check. */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false });
const u = (q, p = []) => sql.unsafe(q, p);

console.log("═══ العدادات مقابل السجلات الفعلية (لكل مشارك) ═══");
const drift = await u(`
  SELECT cp.username,
    p.qualified_count AS counter_q,
    (SELECT COUNT(*) FROM clicks k WHERE k.campaign_id=p.campaign_id AND k.user_id=p.user_id AND k.status='qualified') AS actual_q,
    p.rejected_count AS counter_r,
    (SELECT COUNT(*) FROM clicks k WHERE k.campaign_id=p.campaign_id AND k.user_id=p.user_id AND k.status='rejected') AS actual_r,
    p.total_clicks AS counter_t
  FROM campaign_participants p JOIN creator_profiles cp ON cp.user_id=p.user_id
  ORDER BY p.qualified_count DESC`);
let bad = 0;
for (const r of drift) {
  const okQ = Number(r.counter_q) === Number(r.actual_q);
  const okR = Number(r.counter_r) === Number(r.actual_r);
  const flag = okQ && okR ? "✅" : "🚨";
  if (!okQ || !okR) bad++;
  console.log(
    `${flag} @${r.username}: مؤهلة عداد=${r.counter_q}/فعلي=${r.actual_q} | مرفوضة عداد=${r.counter_r}/فعلي=${r.actual_r} | إجمالي=${r.counter_t}`
  );
}
console.log(bad === 0 ? "\n✅ لا توجد أي زيارة مرفوضة محسوبة — العدادات مطابقة تمامًا" : `\n🚨 ${bad} انحراف!`);

console.log("\n═══ آخر 8 زيارات مرفوضة (هل بعدها ارتفع عداد صاحبها؟) ═══");
const recent = await u(`
  SELECT cp.username, k.reject_reason, k.created_at
  FROM clicks k JOIN creator_profiles cp ON cp.user_id=k.user_id
  WHERE k.status='rejected' ORDER BY k.created_at DESC LIMIT 8`);
for (const r of recent) {
  const t = new Date(Number(r.created_at)).toISOString().slice(11, 19);
  console.log(`  @${r.username} — ${r.reject_reason} — ${t} UTC`);
}

await sql.end();
