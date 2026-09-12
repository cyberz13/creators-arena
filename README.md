# CREATORS ARENA 🏆

**المنصة الرسمية:** <https://www.creatorarena.agency>

منصة سعودية تحوّل مجتمع صناع المحتوى إلى شبكة زيارات حقيقية للمتاجر الإلكترونية عبر نظام تحديات وجوائز.

**الهوية البصرية:** ثيم داكن Premium بنسبة ‎70% أسود (`#08080A`) / 20% أبيض / 10% بنفسجي.
الألوان: Primary `#7C3AED`، Electric `#8B5CF6`، Deep `#4C1D95`، Graphite `#17171C`، Soft Gray `#A1A1AA`.
التدرج الرئيسي: `#A855F7 → #6D28D9`. كل الرموز معرفة في `src/app/globals.css` (`--color-brand-*`).
الشعار الرسمي: `public/logo.png` (شفاف) + `src/app/icon.png` (favicon) — لتحديثه:
`node scripts/process-logo.mjs <الملف الجديد.png>`.
**الخطوط:** Space Grotesk للاتينية والأرقام (الشعار Bold 700، تباعد أوسع في ARENA)
وIBM Plex Sans Arabic للعربية — الترتيب في `--font-sans` يوزعهما تلقائيًا.

**نموذج العمل:** الأدمن يتفق مع المتاجر خارج المنصة وينشئ الحملات بنفسه — المتجر ليس مستخدمًا ولا يملك حسابًا. صناع المحتوى ينضمون للحملة، كلٌّ برابط تتبع خاص، ويتنافسون على جلب أكبر عدد من الزيارات المؤهلة. المتصدر يفوز بالجائزة.

## التشغيل

```bash
npm install
npm run seed   # بيانات تجريبية (20 Creator + 5 حملات + زيارات واقعية)
npm run dev    # http://localhost:3000
```

### حسابات التجربة

| الدور | البريد | كلمة المرور |
|---|---|---|
| Admin | `admin@tahaddi.local` | `Admin@12345` |
| Creator | `sara_style@example.com` (وكل حسابات السييد) | `Creator@123` |

> كلمات المرور الجديدة يجب أن تكون 10 أحرف على الأقل بحروف وأرقام؛ حسابات السييد للتطوير فقط. أول دخول للأدمن يفرض تفعيل المصادقة الثنائية.

### أوامر

```bash
npm test        # 91 اختبارًا (تتبع، احتيال، نتائج، جوائز، جلسات، MFA، XSS، بيئة)
npm run check:http   # فحص أمني عبر HTTP حقيقي على بناء الإنتاج
npm run test:pg      # إثبات التزامن على PostgreSQL محلي (TEST_DATABASE_URL)
npm run build   # بناء الإنتاج
npm run seed    # يمسح قاعدة البيانات ويعيد الزرع — للتطوير فقط
```

## البنية

راجع [ARCHITECTURE.md](./ARCHITECTURE.md) للتفاصيل الكاملة (المخطط، مسار التتبع، كشف الاحتيال، دورة حياة الحملة).

- **Next.js 16 + TypeScript + Tailwind v4** — RTL بالكامل، خط IBM Plex Sans Arabic، Mobile-first
- **قاعدة البيانات:** SQLite عبر `node:sqlite` المدمج في Node 24 — بدون ملفات ثنائية خارجية.
  الـSQL في [src/lib/schema.sql](./src/lib/schema.sql) قياسي وقابل للنقل إلى PostgreSQL/Supabase
- **المصادقة:** جلسات مخزنة في القاعدة (توكن عشوائي، تجزئة فقط، قابلة للإلغاء) + bcrypt + MFA إلزامي للأدمن (TOTP) — راجع [SECURITY.md](./SECURITY.md)
- **منطق الأعمال** كله في `src/services/` — الصفحات تعرض فقط

## نظام التتبع

`GET /go/:code` بخطوتين: صفحة تحقق تحمّل سكربتًا ثابتًا (`/go-challenge.js`) وتحصل على رمز أحادي الاستخدام مرتبط بالكود والـIP والزائر، ثم الطلب الثاني يُصنَّف داخل معاملة واحدة خلف أقفال استشارية:
تجزئة IP بملح سري (لا يُخزن IP خام) → كشف Bots → أهلية المشارك → حد الطلبات → منع التكرار
(جلسة + جهاز خلال نافذة قابلة للضبط) → فحص الشبكة (VPN/مركز بيانات؛ وبدون نتيجة تُحجز الزيارة للمراجعة)
→ التصنيف `qualified / pending_review / rejected` → تحديث العدادات والإحصائيات اليومية → تحويل لرابط المتجر.

الزيارة المؤهلة تعني: تحويلًا اجتاز فلاتر المنصة ولم يُصنَّف كمكرر أو آلي — لا تثبت بذاتها اكتمال تحميل صفحة المتجر أو حدوث شراء.
الترتيب على الزيارات المؤهلة فقط، وكسر التعادل لمن بلغ عدده الحالي أولًا (يُعاد اشتقاقه من سجل الزيارات عند كل مراجعة).
النتائج بعد الانتهاء **أولية** حتى يثبّتها الأدمن، ولا تُعتمد الجوائز قبل ذلك. حساسية الفلاتر من **الإعدادات**، والزيارات المشبوهة في **مراجعة الزيارات**.

## قاعدة البيانات — سائقان خلف واجهة واحدة

- **محليًا (تطوير واختبارات):** SQLite عبر `node:sqlite` تلقائيًا — لا إعداد.
- **الإنتاج (Vercel):** PostgreSQL على Supabase عند ضبط `DATABASE_URL`.
  المخطط في [schema.pg.sql](./src/lib/schema.pg.sql) والطبقة كلها في [db.ts](./src/lib/db.ts).

## النشر: Supabase + Vercel

1. **Supabase**: أنشئ مشروعًا من [supabase.com](https://supabase.com) → Settings → Database →
   انسخ رابط **Transaction Pooler** (المنفذ 6543).
2. **جهّز القاعدة** (مرة واحدة، من جهازك، باتصال المالك وليس اتصال التطبيق):
   ```bash
   MIGRATION_DATABASE_URL="postgresql://..." CONFIRM_PROD_WRITE=I_UNDERSTAND ADMIN_PASSWORD="كلمة-قوية-12+" npm run db:push
   ```
   ثم طبّق `migrations/0001_deny_by_default.sql` من SQL editor وأنشئ كلمة مرور لدور `app_runtime` (راجع PRODUCTION_CHECKLIST.md).
   ينشئ الجداول والتصنيفات وحساب الأدمن — idempotent وآمن التكرار.
3. **Vercel**: اربط المستودع (أو `npx vercel`) واضبط Environment Variables:
   `DATABASE_URL` (بدور app_runtime)، `SESSION_SECRET`، `CHALLENGE_SECRET`، `IP_HASH_SALT`، `MFA_ENCRYPTION_KEY`، `NEXT_PUBLIC_APP_URL`، `REGISTRATION_MODE` — كلها إلزامية والنشر يفشل بدونها (راجع `.env.example`).
4. انشر. رؤوس `X-Forwarded-For` التي يعتمد عليها كشف الاحتيال تصل تلقائيًا على Vercel.

**لا تشغّل `npm run seed` على الإنتاج** — إنه لبيانات SQLite التجريبية المحلية فقط (ويرفض العمل إذا وجد `DATABASE_URL`).
