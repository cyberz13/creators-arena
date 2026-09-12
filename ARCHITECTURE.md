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
| Auth | جلسات مخزنة في القاعدة (توكن عشوائي/تجزئة SHA-256) + bcryptjs + TOTP للأدمن | قابلة للإلغاء فورًا، بدون خدمات خارجية |
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
حد طلبات مبكر لكل IP (429) → صيغة الكود ^[A-Za-z0-9]{6,16}$ → وجود الرابط (وإلا 404 بلا أي كتابة أو استعلام خارجي)
→ الخطوة 1: صفحة تحقق (CSP صارمة، سكربت ثابت، إعدادات JSON مُرمّزة) + nonce أحادي الاستخدام مخزّن ومرتبط بالكود والـIP والزائر
   (+ تسخين فحص الشبكة في الخلفية إن كان مفعّلًا)
→ الخطوة 2 (داخل معاملة، قفل استشاري مشترك للحملة + أقفال ip/session/device):
   استهلاك الـnonce ذريًا → حالة الحملة → أهلية المشارك → bot/automation → rate limit → تكرار جلسة/جهاز
   → فحص الشبكة (مخاطر → مراجعة؛ لا نتيجة → مراجعة ثم اعتماد تلقائي عند وصول نتيجة نظيفة) → سقف الأجهزة لكل IP → sec-fetch
→ INSERT click + عدادات + إحصائيات يومية (بتوقيت الرياض) → 302 للمتجر (يُحوَّل الزائر دائمًا حتى لو لم تُحتسب الزيارة)
```
الإشارات القادمة من العميل (بصمة، webdriver، رؤوس) إشارات مخاطر فقط تخفض التصنيف ولا ترفعه.
كسر التعادل: `qualified_count DESC, last_qualified_at ASC, joined_at ASC` حيث `last_qualified_at` = وقت آخر زيارة مؤهلة (يُعاد اشتقاقه من السجل عند كل مراجعة).

## 7. دورة حياة الحملة
`draft → scheduled → active → ended` (+ `cancelled`)
- الانضمام والزيارات المؤهلة في `active` فقط.
- الإنهاء تلقائي (lazy finalization عند أي قراءة بعد `end_at` + زر Admin): تجميد الترتيب، تحديد الفائزين حسب snapshot الجوائز، إنشاء payouts بحالة `pending`، إشعارات.
- بعد `ended` تكون النتائج **أولية** (`results_status=provisional`): المراجعات تعيد اشتقاق الترتيب والفائزين والاستحقاقات. الأدمن يثبّتها (`final`) بعد خلو قائمة المراجعة؛ بعدها لا تُعدَّل إلا بتصحيح صريح موثق، ولا يتغير استحقاق مدفوع تلقائيًا.
- الأهلية: حساب معطّل (لا دخول ولا احتساب)، مشاركة معلّقة (دخول بلا احتساب)، استبعاد من حملة — تُطبَّق عند الاحتساب وفي الترتيب.
- الإنهاء والمراجعة والصرف تحديثات شرطية داخل معاملات خلف أقفال استشارية، مع سجل التدقيق والإشعارات (بمفاتيح منع تكرار) داخل المعاملة نفسها.

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
