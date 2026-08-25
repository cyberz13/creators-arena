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

### أوامر

```bash
npm test        # 24 اختبارًا لمنطق الأعمال (تتبع، احتيال، ترتيب، جوائز)
npm run build   # بناء الإنتاج
npm run seed    # يمسح قاعدة البيانات ويعيد الزرع — للتطوير فقط
```

## البنية

راجع [ARCHITECTURE.md](./ARCHITECTURE.md) للتفاصيل الكاملة (المخطط، مسار التتبع، كشف الاحتيال، دورة حياة الحملة).

- **Next.js 16 + TypeScript + Tailwind v4** — RTL بالكامل، خط IBM Plex Sans Arabic، Mobile-first
- **قاعدة البيانات:** SQLite عبر `node:sqlite` المدمج في Node 24 — بدون ملفات ثنائية خارجية.
  الـSQL في [src/lib/schema.sql](./src/lib/schema.sql) قياسي وقابل للنقل إلى PostgreSQL/Supabase
- **المصادقة:** جلسات JWT (httpOnly) + bcrypt — server-side بالكامل
- **منطق الأعمال** كله في `src/services/` — الصفحات تعرض فقط

## نظام التتبع

`GET /go/:code` — server-side بالكامل:
تجزئة IP بملح سري (لا يُخزن IP خام) → كشف Bots → Rate limiting → منع التكرار
(جلسة + IP خلال نافذة قابلة للضبط) → التصنيف `qualified / pending_review / rejected`
→ تحديث العدادات والإحصائيات اليومية → إشعارات تغير الصدارة → تحويل لرابط المتجر.

الترتيب يعتمد على الزيارات المؤهلة فقط، وكسر التعادل لمن وصل للعدد أولًا. حساسية
كشف الاحتيال قابلة للضبط من **لوحة الأدمن → الإعدادات**، والزيارات المشبوهة تُعرض
في **مراجعة الزيارات** لقرار يدوي.

## قاعدة البيانات — سائقان خلف واجهة واحدة

- **محليًا (تطوير واختبارات):** SQLite عبر `node:sqlite` تلقائيًا — لا إعداد.
- **الإنتاج (Vercel):** PostgreSQL على Supabase عند ضبط `DATABASE_URL`.
  المخطط في [schema.pg.sql](./src/lib/schema.pg.sql) والطبقة كلها في [db.ts](./src/lib/db.ts).

## النشر: Supabase + Vercel

1. **Supabase**: أنشئ مشروعًا من [supabase.com](https://supabase.com) → Settings → Database →
   انسخ رابط **Transaction Pooler** (المنفذ 6543).
2. **جهّز القاعدة** (مرة واحدة، من جهازك):
   ```bash
   DATABASE_URL="postgresql://..." ADMIN_PASSWORD="كلمة-قوية" npm run db:push
   ```
   ينشئ الجداول والتصنيفات وحساب الأدمن — idempotent وآمن التكرار.
3. **Vercel**: اربط المستودع (أو `npx vercel`) واضبط Environment Variables:
   `DATABASE_URL`, `SESSION_SECRET`, `IP_HASH_SALT`, `NEXT_PUBLIC_APP_URL` (نطاق الموقع).
4. انشر. رؤوس `X-Forwarded-For` التي يعتمد عليها كشف الاحتيال تصل تلقائيًا على Vercel.

**لا تشغّل `npm run seed` على الإنتاج** — إنه لبيانات SQLite التجريبية المحلية فقط (ويرفض العمل إذا وجد `DATABASE_URL`).
