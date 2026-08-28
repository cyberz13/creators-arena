/**
 * Forensic audit of the fraud-review logic against LIVE data.
 * Read-only. Usage: DATABASE_URL=... node scripts/audit-clicks.mjs
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false });
const u = (q, p = []) => sql.unsafe(q, p);

console.log("═══ 1) نظرة عامة على النقرات لكل صانع ═══");
const perCreator = await u(`
  SELECT cp.username,
    COUNT(*) AS total,
    SUM(CASE WHEN k.status='qualified' THEN 1 ELSE 0 END) AS qualified,
    SUM(CASE WHEN k.status='rejected' THEN 1 ELSE 0 END) AS rejected,
    COUNT(DISTINCT k.ip_hash) AS unique_ips,
    COUNT(DISTINCT k.session_id) AS unique_sessions,
    COUNT(DISTINCT CASE WHEN k.status='qualified' THEN k.ip_hash END) AS q_unique_ips,
    COUNT(DISTINCT CASE WHEN k.status='qualified' THEN k.session_id END) AS q_unique_sessions
  FROM clicks k JOIN creator_profiles cp ON cp.user_id = k.user_id
  GROUP BY cp.username ORDER BY qualified DESC`);
for (const r of perCreator) {
  console.log(
    `@${r.username}: إجمالي=${r.total} مؤهلة=${r.qualified} مرفوضة=${r.rejected} | ` +
      `IPs فريدة=${r.unique_ips} جلسات فريدة=${r.unique_sessions} | ` +
      `المؤهلة من ${r.q_unique_ips} IP و${r.q_unique_sessions} جلسة`
  );
}

console.log("\n═══ 2) فحص التكامل: انتهاكات منع التكرار (يجب أن يكون صفرًا) ═══");
const dupSession = await u(`
  SELECT campaign_id, session_id, COUNT(*) AS c,
    MAX(created_at) - MIN(created_at) AS span_ms
  FROM clicks WHERE status='qualified'
  GROUP BY campaign_id, session_id
  HAVING COUNT(*) > 1 AND MAX(created_at) - MIN(created_at) < 86400000`);
console.log(`جلسات بأكثر من زيارة مؤهلة خلال 24س: ${dupSession.length} ${dupSession.length === 0 ? "✅" : "🚨 خلل!"}`);
const dupIp = await u(`
  SELECT campaign_id, ip_hash, COUNT(*) AS c,
    MAX(created_at) - MIN(created_at) AS span_ms
  FROM clicks WHERE status='qualified'
  GROUP BY campaign_id, ip_hash
  HAVING COUNT(*) > 1 AND MAX(created_at) - MIN(created_at) < 86400000`);
console.log(`IPs بأكثر من زيارة مؤهلة خلال 24س: ${dupIp.length} ${dupIp.length === 0 ? "✅" : "🚨 خلل!"}`);
for (const r of dupIp.slice(0, 5)) {
  console.log(`   🚨 ip=${r.ip_hash.slice(0, 10)} عدد=${r.c} خلال ${Math.round(r.span_ms / 60000)} دقيقة`);
}

console.log("\n═══ 3) فحص تطابق العدادات (participants vs clicks) ═══");
const drift = await u(`
  SELECT cp.username, p.qualified_count AS counter,
    (SELECT COUNT(*) FROM clicks k WHERE k.campaign_id=p.campaign_id AND k.user_id=p.user_id AND k.status='qualified') AS actual
  FROM campaign_participants p JOIN creator_profiles cp ON cp.user_id=p.user_id`);
let driftBad = 0;
for (const r of drift) {
  const ok = Number(r.counter) === Number(r.actual);
  if (!ok) { driftBad++; console.log(`   🚨 @${r.username}: العداد=${r.counter} الفعلي=${r.actual}`); }
}
console.log(driftBad === 0 ? "كل العدادات مطابقة للسجلات ✅" : `${driftBad} عداد منحرف 🚨`);

console.log("\n═══ 4) التوزيع الزمني لزيارات المتصدرة (كشف الأنماط الآلية) ═══");
const top = perCreator[0];
if (top) {
  const gaps = await u(`
    SELECT k.created_at FROM clicks k
    JOIN creator_profiles cp ON cp.user_id=k.user_id
    WHERE cp.username=$1 AND k.status='qualified'
    ORDER BY k.created_at`, [top.username]);
  const times = gaps.map((g) => Number(g.created_at));
  const deltas = times.slice(1).map((t, i) => (t - times[i]) / 1000);
  const under5s = deltas.filter((d) => d < 5).length;
  const under60s = deltas.filter((d) => d < 60).length;
  const spanMin = times.length > 1 ? Math.round((times.at(-1) - times[0]) / 60000) : 0;
  console.log(`@${top.username}: ${times.length} مؤهلة على مدى ${spanMin} دقيقة`);
  console.log(`   فجوات <5 ثوانٍ: ${under5s} | فجوات <60 ثانية: ${under60s}`);
  console.log(`   ${under5s > times.length * 0.5 ? "🚩 نمط آلي محتمل (رشقات سريعة)" : "✅ إيقاع بشري (متباعد)"}`);
}

console.log("\n═══ 5) عينة أسباب الرفض ═══");
const reasons = await u(`
  SELECT reject_reason, COUNT(*) AS c FROM clicks
  WHERE status='rejected' GROUP BY reject_reason ORDER BY c DESC`);
for (const r of reasons) console.log(`   ${r.reject_reason}: ${r.c}`);

await sql.end();
