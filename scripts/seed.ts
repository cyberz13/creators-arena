/**
 * Development seed — creates 20 creators, 5 campaigns, and realistic tracking
 * events through the real pipeline. Never run against production data.
 * SQLite (local dev) only — for Supabase use scripts/db-push.mjs instead.
 *
 *   npm run seed          (wipes data/tahaddi.db and reseeds)
 */
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { id, now, run, one } from "../src/lib/db";
import { createCampaign, joinCampaign, finalizeCampaign } from "../src/services/campaigns";
import { recordClick } from "../src/services/tracking";

if (process.env.DATABASE_URL) {
  console.error("❌ هذا السكربت للتطوير المحلي (SQLite) فقط — أزل DATABASE_URL أولًا");
  process.exit(1);
}

const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "tahaddi.db");
if (fs.existsSync(dbPath)) {
  // Deleting the DB while `next dev` holds it open crashes node:sqlite natively.
  try {
    const fd = fs.openSync(dbPath, "r+");
    fs.closeSync(fd);
  } catch {
    console.error("❌ قاعدة البيانات مفتوحة — أوقف خادم التطوير (next dev) ثم أعد المحاولة");
    process.exit(1);
  }
  fs.rmSync(dbPath);
  for (const suffix of ["-wal", "-shm"]) {
    if (fs.existsSync(dbPath + suffix)) fs.rmSync(dbPath + suffix);
  }
  console.log("🗑️  حذف قاعدة البيانات القديمة");
}

const CREATORS: [string, string, string, number][] = [
  ["سارة العتيبي", "sara.style", "fashion", 8200],
  ["نورة القحطاني", "noura_vlogs", "lifestyle", 6500],
  ["ريم الدوسري", "reem.daily", "beauty", 9800],
  ["فيصل الحربي", "faisal.tech", "tech", 4300],
  ["لمى الشهري", "lama.eats", "food", 7100],
  ["عبدالله السبيعي", "abdullah.fit", "fitness", 3900],
  ["هند المطيري", "hind.travels", "travel", 5600],
  ["محمد الغامدي", "mo.gaming", "gaming", 8900],
  ["دانة العنزي", "dana.beauty", "beauty", 2400],
  ["خالد الزهراني", "khaled.reviews", "tech", 1800],
  ["مها الرشيدي", "maha.style", "fashion", 6200],
  ["تركي العمري", "turki.vlogs", "lifestyle", 3100],
  ["جود الخالدي", "joud.food", "food", 9200],
  ["ناصر الشمري", "nasser.fit", "fitness", 2700],
  ["رهف البقمي", "rahaf.daily", "general", 4800],
  ["سلطان المالكي", "sultan.gaming", "gaming", 7700],
  ["غلا الحارثي", "ghala.beauty", "beauty", 5300],
  ["يزيد التميمي", "yazeed.tech", "tech", 2100],
  ["شهد العجمي", "shahad.travel", "travel", 6800],
  ["بدر القرني", "badr.reviews", "general", 1500],
];

const DAY = 86_400_000;
const T = now();

interface CampaignSpec {
  title: string;
  store: string;
  url: string;
  desc: string;
  prizes: number[];
  startOffset: number;
  endOffset: number;
  participants: number;
  clicksPerDay: [number, number];
  finalize?: boolean;
  draft?: boolean;
}

const SPECS: CampaignSpec[] = [
  {
    title: "🔥 تحدي متجر لمسة", store: "متجر لمسة", url: "https://example.com/lamsa",
    desc: "متجر عطور وهدايا فاخرة — اجلب زيارات حقيقية واربح!",
    prizes: [500, 250, 100], startOffset: -5 * DAY, endOffset: 3 * DAY,
    participants: 12, clicksPerDay: [15, 60],
  },
  {
    title: "⚡ تحدي متجر تِك زون", store: "تك زون", url: "https://example.com/techzone",
    desc: "أحدث الإلكترونيات والإكسسوارات الذكية.",
    prizes: [750], startOffset: -3 * DAY, endOffset: 5 * DAY,
    participants: 9, clicksPerDay: [10, 45],
  },
  {
    title: "🌿 تحدي متجر عناية", store: "عناية", url: "https://example.com/enaya",
    desc: "منتجات العناية بالبشرة والشعر الطبيعية.",
    prizes: [400, 200], startOffset: -1 * DAY, endOffset: 7 * DAY,
    participants: 7, clicksPerDay: [8, 30],
  },
  {
    title: "🏁 تحدي متجر خطوة (منتهي)", store: "خطوة", url: "https://example.com/khatwa",
    desc: "أحذية رياضية أصلية بأسعار منافسة.",
    prizes: [600, 300, 150], startOffset: -14 * DAY, endOffset: -2 * DAY,
    participants: 14, clicksPerDay: [20, 70], finalize: true,
  },
  {
    title: "📝 تحدي متجر ذوق (مسودة)", store: "ذوق", url: "https://example.com/thouq",
    desc: "أثاث منزلي عصري.",
    prizes: [450], startOffset: 2 * DAY, endOffset: 9 * DAY,
    participants: 0, clicksPerDay: [0, 0], draft: true,
  },
];

const SOURCES = [
  { referer: "https://www.tiktok.com/@user/video/123", utm: "tiktok", weight: 5 },
  { referer: "https://l.instagram.com/", utm: "instagram", weight: 3 },
  { referer: "https://www.snapchat.com/", utm: "snapchat", weight: 2 },
  { referer: null, utm: null, weight: 3 },
];

let rngState = 42;
function rng() {
  rngState = (rngState * 1103515245 + 12345) % 2 ** 31;
  return rngState / 2 ** 31;
}

function pickSource() {
  const total = SOURCES.reduce((a, s) => a + s.weight, 0);
  let r = rng() * total;
  for (const s of SOURCES) {
    r -= s.weight;
    if (r <= 0) return s;
  }
  return SOURCES[0];
}

const UA_HUMAN =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

async function main() {
  const adminId = (await one<{ id: string }>("SELECT id FROM users WHERE role = 'admin'"))!.id;
  const passwordHash = bcrypt.hashSync("Creator@123", 10);

  const creatorIds: string[] = [];
  for (const [name, username, category, followers] of CREATORS) {
    const userId = id();
    await run(
      "INSERT INTO users (id, email, password_hash, role, status, created_at) VALUES (?, ?, ?, 'creator', 'active', ?)",
      userId,
      `${username.replace(/\./g, "_")}@example.com`,
      passwordHash,
      now() - 40 * DAY
    );
    await run(
      `INSERT INTO creator_profiles (user_id, name, username, tiktok, instagram, followers_count, category_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      userId,
      name,
      username,
      `@${username}`,
      `@${username}`,
      followers,
      category,
      now() - 40 * DAY
    );
    creatorIds.push(userId);
  }
  console.log(`👤 ${creatorIds.length} صانع محتوى (كلمة المرور: Creator@123)`);

  let visitorN = 0;

  for (const spec of SPECS) {
    const campaign = await createCampaign(
      {
        title: spec.title,
        description: spec.desc,
        requirements: "",
        store_name: spec.store,
        store_url: spec.url,
        start_at: T - 1000,
        end_at: T + 30 * DAY,
        prizes: spec.prizes,
      },
      adminId,
      !spec.draft
    );
    await run(
      "UPDATE campaigns SET start_at = ?, end_at = ? WHERE id = ?",
      T + spec.startOffset,
      T + spec.endOffset,
      campaign.id
    );

    if (spec.draft) {
      console.log(`📝 ${spec.title}`);
      continue;
    }

    // Temporarily keep campaign active while generating historical clicks
    await run("UPDATE campaigns SET end_at = ? WHERE id = ?", T + 30 * DAY, campaign.id);

    const members = creatorIds.slice(0, spec.participants);
    const links = [];
    for (const uid of members) links.push(await joinCampaign(campaign.id, uid));

    const startMs = T + spec.startOffset;
    const endMs = Math.min(T + spec.endOffset, T);
    const days = Math.max(1, Math.round((endMs - startMs) / DAY));
    let totalClicks = 0;

    for (let d = 0; d < days; d++) {
      for (let li = 0; li < links.length; li++) {
        const popularity = 1 - li / links.length;
        const [lo, hi] = spec.clicksPerDay;
        const count = Math.round((lo + rng() * (hi - lo)) * popularity * 0.2);
        for (let k = 0; k < count; k++) {
          visitorN++;
          const ts = startMs + d * DAY + Math.floor(rng() * DAY * 0.9);
          const src = pickSource();
          const roll = rng();
          if (roll < 0.06) {
            await recordClick({
              code: links[li].code, ipHash: `seed-bot-${visitorN}`, sessionId: `seed-bot-s-${visitorN}`,
              deviceHash: `seed-bot-d-${visitorN}`,
              userAgent: "python-requests/2.31", referer: null, utmSource: null, nowMs: ts,
            });
          } else if (roll < 0.14) {
            await recordClick({
              code: links[li].code, ipHash: `seed-ip-${visitorN - 1}`, sessionId: `seed-s-${visitorN - 1}`,
              deviceHash: `seed-d-${visitorN - 1}`,
              userAgent: UA_HUMAN, referer: src.referer, utmSource: src.utm, nowMs: ts + 30_000,
            });
          } else {
            await recordClick({
              code: links[li].code, ipHash: `seed-ip-${visitorN}`, sessionId: `seed-s-${visitorN}`,
              deviceHash: `seed-d-${visitorN}`,
              userAgent: UA_HUMAN, referer: src.referer, utmSource: src.utm, nowMs: ts,
            });
          }
          totalClicks++;
        }
      }
    }

    await run("UPDATE campaigns SET end_at = ? WHERE id = ?", T + spec.endOffset, campaign.id);
    if (spec.finalize) {
      await finalizeCampaign(campaign.id);
      console.log(`🏁 ${spec.title} — ${totalClicks} نقرة، تم تحديد الفائزين`);
    } else {
      console.log(`✅ ${spec.title} — ${totalClicks} نقرة`);
    }
  }

  const stats = (await one<{ total: number; q: number; r: number; p: number }>(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN status='qualified' THEN 1 ELSE 0 END) AS q,
       SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS r,
       SUM(CASE WHEN status='pending_review' THEN 1 ELSE 0 END) AS p
     FROM clicks`
  ))!;
  console.log(`\n📊 الزيارات: ${stats.total} إجمالي — ${stats.q} مؤهلة، ${stats.r} مرفوضة، ${stats.p} قيد المراجعة`);
  console.log("\n🔑 حسابات الدخول:");
  console.log("   Admin:   admin@tahaddi.local / Admin@12345");
  console.log("   Creator: sara_style@example.com / Creator@123  (وكل الحسابات الأخرى بنفس كلمة المرور)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
