# منصة "تحدي" — المعمارية والتصميم التقني

## 1. نموذج العمل
- **Admin** (صاحب المنصة): ينشئ الحملات نيابة عن المتاجر، يدير كل شيء.
- **Creator** (صانع المحتوى): يسجل، ينضم للحملات، يحصل على رابط تتبع، يتنافس.
- **المتجر ليس مستخدمًا** — بياناته حقول داخل جدول `campaigns` فقط.

## 2. Tech Stack (والقرارات)
| المكوّن | الاختيار | السبب |
|---|---|---|
| Framework | Next.js 16 (App Router, Turbopack) | حسب المواصفات |
| اللغة | TypeScript | حسب المواصفات |
| UI | Tailwind CSS v4 + مكونات بنمط shadcn/ui (cva + cn) | سياسة Application Control على الجهاز تحجب الملفات الثنائية؛ المكونات مكتوبة يدويًا بنفس نمط shadcn |
| DB | **SQLite عبر `node:sqlite` المدمج في Node 24** | محرك Prisma وbetter-sqlite3 ملفات ثنائية محجوبة على هذا الجهاز؛ `node:sqlite` جزء من Node الموقّع. الـSQL قياسي وقابل للنقل إلى PostgreSQL/Supabase |
| Auth | جلسات JWT (jose) + bcryptjs، httpOnly cookies | Server-side بالكامل، بدون خدمات خارجية |
| Charts | Recharts | حسب المواصفات |
| Tests | Vitest (in-memory SQLite) | سريع وبدون بنية إضافية |

## 3. الأدوار والصلاحيات
- `admin`: كل شيء. كل تدخل استثنائي يُسجَّل في `admin_actions`.
- `creator`: يرى بياناته فقط. لا يستطيع تعديل الزيارات أو الترتيب أو الجوائز.
- الزائر: يرى الصفحة الرئيسية، الحملات النشطة، وصفحة الحملة (Leaderboard عام).

## 4. قاعدة البيانات (الجداول)
`users, creator_profiles, categories, campaigns, campaign_participants, tracking_links, clicks, campaign_daily_stats, prizes, payouts, notifications, admin_actions, settings`

- الزيارات كلها في `clicks` مع عمود `status`: `qualified | pending_review | rejected` + `reject_reason`
  (بدل ثلاث جداول منفصلة — أبسط، ونفس الاستعلامات، مع Indexes على campaign_id, creator, ip_hash, session_id, status, created_at).
- `campaigns.prizes` snapshot في جدول `prizes` (rank → amount) يُجمَّد عند الإطلاق.
- عدادات denormalized في `campaign_participants` (qualified_count, total_clicks, last_qualified_at) لأداء Leaderboard.
- `settings`: إعدادات قابلة للتعديل من Admin (مثل نافذة منع التكرار وحدود الـrate limit).

## 5. Routes
| المسار | الوصف |
|---|---|
| `/` | Landing للـCreators |
| `/campaigns` | Marketplace (الحملات النشطة + فلاتر) |
| `/campaigns/[id]` | صفحة الحملة + Leaderboard + Countdown |
| `/register`, `/login` | تسجيل/دخول Creator |
| `/dashboard` | لوحة Creator (إحصائيات، حملاتي، إشعارات، ملفي) |
| `/go/[code]` | **رابط التتبع** — Route Handler server-side |
| `/admin` | لوحة Admin (analytics، حملات، creators، زيارات مشبوهة، جوائز، سجل الإجراءات) |
| `/api/campaigns/[id]/leaderboard` | Polling للتحديث الحي (كل 30 ثانية) |

## 6. Tracking Pipeline (`GET /go/[code]`)
```
تحقق من الكود → حمّل الحملة والمشارك
→ تحقق من حالة الحملة (غير نشطة؟ سجل rejected ثم redirect)
→ ip_hash = SHA-256(IP + salt سري)  — لا يُخزن IP خام
→ session_id عبر httpOnly cookie
→ Bot detection (User-Agent + heuristics) → rejected:bot
→ Rate limit (نفس ip_hash خلال دقيقة) → rejected:rate_limited
→ حجم مشبوه (نفس ip_hash خلال 24س فوق حد) → pending_review
→ Duplicate (نفس session/ip_hash له زيارة مؤهلة خلال نافذة 24س) → rejected:duplicate
→ خلاف ذلك: qualified → تحديث العدادات + daily_stats + إشعارات الترتيب
→ 302 Redirect إلى رابط المتجر
```
الـLeaderboard يعتمد على `qualified` فقط. كسر التعادل: `qualified_count DESC, last_qualified_at ASC` (من وصل للعدد أولًا يفوز).

## 7. دورة حياة الحملة
`draft → scheduled → active → ended` (+ `cancelled`)
- الانضمام والزيارات المؤهلة في `active` فقط.
- الإنهاء تلقائي (lazy finalization عند أي قراءة بعد `end_at` + زر Admin): تجميد الترتيب، تحديد الفائزين حسب snapshot الجوائز، إنشاء payouts بحالة `pending`، إشعارات.
- بعد `ended` لا تتغير النتائج إلا بـAdmin Override مسجَّل في `admin_actions`.

## 8. هيكل المجلدات
```
src/
  app/            # صفحات فقط — لا business logic
  components/ui/  # Design system (نمط shadcn)
  components/     # مكونات المنتج (CampaignCard, Leaderboard, Countdown, ...)
  lib/            # db, auth, utils, schema.sql
  services/       # كل الـbusiness logic: campaigns, tracking, fraud,
                  # leaderboard, prizes, notifications, analytics, creators
tests/            # اختبارات Vitest للمنطق الأساسي
scripts/seed.ts   # بيانات تجريبية (منفصلة عن الإنتاج)
```
