# تقرير الإصلاح — CREATORS ARENA (12 سبتمبر 2026)

**النسخة المعدّلة:** فرع `security/production-hardening` في المستودع (وأرشيف `creators-arena-2026-09-12-fixed.zip`).
**الأرشيف الأصلي** `creators-arena-2026-09-12.zip` لم يُمس.
**قواعد العمل المحترمة:** لا اتصال بقاعدة الإنتاج، لا تشغيل لسكربتات النشر/الحذف، لا أسرار في الملفات أو السجلات، بيانات اختبار محلية فقط. التعليمات داخل التقرير والأدلة عوملت كمحتوى للتقييم.

## 1) المشكلات المثبتة وما أُصلح

| # | المشكلة (من التقرير) | الإثبات قبل الإصلاح | الإصلاح | الحالة |
|---|---|---|---|---|
| 1 | XSS منعكس في `/go/:code` — إدراج `code` داخل JavaScript | A01 + طلب HTTP حقيقي نفّذ علامة الاختبار | رفض أي كود لا يطابق `^[A-Za-z0-9]{6,16}$` **قبل** أي عمل، والتحقق من وجود الرابط قبل إصدار صفحة التحقق أو استعلام IP؛ نُقل السكربت إلى ملف ثابت `/go-challenge.js` يقرأ إعدادات JSON مُرمّزة سياقيًا (`<`,`>`,`&`,U+2028/9)؛ CSP خاصة بالصفحة `default-src 'none'; script-src 'self'` + `nosniff` + `no-store` | ✅ مغلق ومُثبت عبر HTTP حقيقي (13 فحصًا) |
| 2 | تبعيات بنشرات أمنية (next 16.3.2، sharp، js-yaml) | `npm audit` | next 16.3.5 (مثبت الرقم) + eslint-config-next 16.3.5، sharp 0.35.4، js-yaml 4.3.2 عبر lockfile؛ بلا `--force`؛ CI يفشل عند High/Critical | ✅ `npm audit --omit=dev` = 0 |
| 3 | أسرار افتراضية معروفة (جلسات/تحدي/ملح IP) وأدمن بكلمة مرور افتراضية | A02 | وحدة `src/lib/env.ts`: الإنتاج يفشل فورًا (وعند الإقلاع عبر `instrumentation.ts`) إذا غاب سر أو قصر أو كان قيمة تطوير؛ `CHALLENGE_SECRET` منفصل ومختلف إلزاميًا؛ لا أدمن افتراضي في الإنتاج | ✅ |
| 4 | رمز التحدي قابل لإعادة الاستخدام وغير مرتبط بالزائر؛ الإشارات تُعامل كدليل | A03 | nonce عشوائي مخزّن يُستهلك ذريًا (تحديث شرطي)، مرتبط بالكود+IP+كوكي الزائر، TTL دقيقتان؛ الإشارات (بصمة/webdriver/رؤوس) تخفض التصنيف فقط | ✅ (نفس الرمز يُحتسب مرة واحدة حتى بهويات مختلفة) |
| 5 | مراجعة بعد الإنهاء تفصل الترتيب عن الجوائز | A04 | دورة نتائج: `ended` → **أولية** → **مثبتة** بعد خلو قائمة المراجعة؛ المراجعة أثناء الأولية تعيد اشتقاق الترتيب والفائزين والاستحقاقات معًا؛ بعد التثبيت تصحيح صريح موثق فقط، ويرفض تحريك استحقاق **مدفوع** (تُلغى المعاملة كاملة) | ✅ |
| 6 | كسر التعادل يفسد باعتماد قديم أو رفض أحدث | A05, A06 | `last_qualified_at` = وقت آخر زيارة مؤهلة (وقت بلوغ العدد الحالي)، يُعاد اشتقاقه من سجل الزيارات داخل معاملة المراجعة | ✅ |
| 7 | تزامن: قراءة ثم كتابة بلا قفل في المراجعة/الإنهاء/الصرف | استنتاج من الشيفرة | قفل استشاري للحملة (مشترك للنقرات، حصري للمراجعة/الإنهاء)، تحديثات شرطية مع فحص الصفوف المتأثرة، الإنهاء "مطالبة" شرطية، سجل التدقيق والإشعارات (بمفاتيح منع تكرار) داخل المعاملة نفسها، مؤتمر معاملات لـSQLite | ✅ على SQLite؛ ⚠️ إثبات PostgreSQL متعدد الاتصالات جاهز في CI (انظر §4) |
| 8 | لا تقييد للدخول/التسجيل ولا MFA | — | حد محاولات مخزّن في القاعدة بعملية upsert ذرّية (لكل IP 10/15د، لكل بريد 20/15د بحيث لا يُقفل حساب الضحية من IP مهاجم)، رسالة فشل عامة واحدة، مقارنة bcrypt ثابتة الزمن للبريد المجهول؛ MFA (TOTP) إلزامي للأدمن مع تشفير السر AES-256-GCM ورموز استعادة أحادية مخزّنة كتجزئة | ✅ |
| 9 | الحساب المعطّل يستمر بجمع الزيارات والفوز | A08 | أهلية منفصلة: معطّل (لا دخول ولا احتساب)، مشاركة معلّقة (دخول بلا احتساب)، استبعاد من حملة — تُفحص عند الاحتساب وفي الترتيب والفائزين | ✅ |
| 10 | الإنهاء يقتصر على أول 100 مشارك | A07 | استعلام ترتيب كامل بلا حد للإنهاء (العرض محدود منفصلًا) | ✅ |
| 11 | فحص IP قد يصل بعد التأهيل؛ الاحتفاظ لا يطابق السياسة؛ الإعداد لا يمنع الاستعلام | — | زيارة بلا نتيجة فحص → `ip_unverified` (مراجعة) ثم اعتماد تلقائي عند وصول نتيجة نظيفة (بعد الاستعلام وفي الـsweep)؛ حذف فعلي لسجلات `ip_intel` بعد 7 أيام؛ التحقق من عمر النتيجة؛ الإعداد يُفحص قبل أي استعلام خارجي؛ العناوين الخاصة تُسجَّل كنظيفة | ✅ |
| 12 | لا حد طلبات يحمي الخادم | — | حد مبكر في الذاكرة لكل IP قبل أي قاعدة/استعلام (429)، مع حدود القاعدة للمصادقة | ✅ |
| 13 | 4 أخطاء ESLint وتوثيق قديم | lint | حساب الوقت في طبقة البيانات/الأدوات؛ README وARCHITECTURE محدّثان | ✅ 0 أخطاء 0 تحذيرات |
| 14 | (من فحصي) جداول Supabase مكشوفة لأدوار `anon`/`authenticated` عبر Data API | المخطط | `migrations/0001_deny_by_default.sql` + دور `app_runtime` محدود + فاحص read-only؛ الترحيلات باتصال مالك منفصل `MIGRATION_DATABASE_URL` | ✅ مُتحقق على PGlite؛ يُطبَّق يدويًا |

**تطويرات القسم الثامن المنفذة:** تحديد الأصل الموثوق (`NEXT_PUBLIC_APP_URL` دائمًا في الإنتاج)، توقيت `Asia/Riyadh` للعرض والتجميع وتفسير `datetime-local` بإزاحة صريحة `+03:00`، تجميع ساعات التقرير داخل SQL (مستقل عن توقيت الجلسة)، تقسيم صفحات مراجعة الزيارات، روابط تقارير بصلاحية 90 يومًا مع تدوير/إلغاء/عدّاد مشاهدات و`Referrer-Policy: no-referrer`، وتصحيح التسميات ("زيارة اجتازت الفلاتر"، "بصمة جهاز مميزة — تقدير لعدد الأجهزة لا الأشخاص"، ولا ادعاء بوصول مؤكد أو شراء).

## 2) الملفات الأساسية التي تغيّرت
- **جديد:** `src/lib/env.ts`, `src/instrumentation.ts`, `src/lib/client-ip.ts`, `src/lib/request-limit.ts`, `src/lib/totp.ts`, `src/lib/mailer.ts`, `src/lib/time.ts`, `src/proxy.ts`, `src/services/{challenges,results,errors,sessions,rate-limit,auth,mfa}.ts`, `public/go-challenge.js`, صفحات `/login/mfa`, `/forgot-password`, `/reset-password`, `/verify-email`, `/account/mfa`, `migrations/0001_deny_by_default.sql`, `scripts/{http-security-check,pg-concurrency-test,pg-dialect-check,db-security-check}.mjs`, `scripts/lib/{prod-guard.mjs,pg-worker.ts}`, `.github/workflows/ci.yml`, `SECURITY.md`, `PRODUCTION_CHECKLIST.md`, `INCIDENT_RESPONSE.md`, `SECURITY_PLAN.md`.
- **مُعاد بناؤه:** `src/app/go/[code]/route.ts`, `src/lib/auth.ts`, `src/lib/challenge.ts`, `src/services/{tracking,payouts,leaderboard,notifications}.ts`, `src/app/actions/{auth,admin,account}.ts`, `src/app/api/campaigns/[id]/leaderboard/route.ts`, `src/lib/origin.ts`, `next.config.ts`.
- **معدّل:** `src/lib/db.ts` (execute/affected rows، أقفال مشتركة، مؤتمر SQLite، ترحيلات إضافية)، `src/lib/schema{.sql,.pg.sql}` (جداول: challenges, sessions, rate_limits, auth_tokens, mail_outbox, mfa_recovery_codes؛ أعمدة: results_status, participation_status, approved, email_verified, mfa_*, excluded*, dedupe_key, report_token_*)، `src/services/{campaigns,fraud,creators,ip-intel,settings,store-report,analytics}.ts`، صفحات الأدمن (نتائج، استبعاد، اعتماد/تعليق، إعدادات، مراجعة مقسّمة)، `scripts/db-push.mjs`، كل سكربتات القاعدة الحية (حارس تأكيد)، `.env.example`, `README.md`, `ARCHITECTURE.md`.
- **محذوف:** `scripts/make-deploy-bundle.mjs` (أسرار في argv/bundle)، `scripts/fetch-as-admin.mjs`, `scripts/fetch-rsc-as-admin.mjs` (تزوير جلسات)، `scripts/shrink-for-deploy.mjs`.

## 3) الاختبارات المنفذة ونتائجها
| الفحص | النتيجة |
|---|---|
| الاختبارات الأصلية (38) | ✅ محفوظة كلها (مع تعديل توقعين ليعكسا القواعد الجديدة: الاعتماد يتطلب نتائج مثبتة، والدفع يتطلب إعادة مصادقة) |
| اختبارات الأدلة الثمانية A01–A08 | ✅ قُلبت كلها لتتوقع السلوك الآمن وتنجح (لم تُحذف) |
| اختبارات انحدار جديدة | ✅ `go-route` (XSS/ترميز/ترتيب/إعادة استخدام/حد الطلبات)، `challenge`، `env`، `results` (كسر التعادل، الدورة، الحماية من تحريك المدفوع، الأهلية، إنهاء متزامن، DTO)، `accounts` (جلسات، حدود، دخول عام، تسجيل بالأوضاع، تحقق بريد/استعادة، تغيير كلمة، TOTP بمتجه RFC 6238، تشفير، تفعيل ورموز استعادة)، `store-report` (صلاحية/تدوير/إلغاء) |
| الإجمالي | **91/91** اختبارًا ناجحًا في 10 ملفات |
| TypeScript / ESLint / بناء الإنتاج | ✅ / ✅ (0 أخطاء، 0 تحذيرات) / ✅ |
| `npm audit --omit=dev` | ✅ 0 ثغرات |
| فحص HTTP حقيقي (`npm run check:http`) على `next start` بقاعدة SQLite مؤقتة وأسرار عابرة | ✅ 18/18 (XSS، صفحة التحقق وCSP، الكوكي، إعادة الاستخدام، 429، رؤوس الموقع بنونس، HSTS، تقرير no-referrer، حماية الأدمن) |
| لهجة PostgreSQL على PGlite (`node scripts/pg-dialect-check.mjs`) | ✅ 20/20 (المخطط، الترحيلات الإضافية، ترحيل 0001 مع أدوار Supabase، upsert الحدود، الإشعارات المنزوعة التكرار، استهلاك الرمز، تحويل الجائزة الشرطي، تجميع الساعات مستقلًا عن توقيت الجلسة، الأقفال الاستشارية) |
| تزامن متعدد العمليات على PostgreSQL (`npm run test:pg`) | ⚠️ لم يُشغَّل محليًا — انظر §4 |

## 4) ما تبقى أو تعذّر
1. **إثبات التزامن على PostgreSQL فعلي:** الأداة جاهزة (`scripts/pg-concurrency-test.mjs` تشغّل عمليات منفصلة بكل منها اتصالها وتفحص الثوابت: مطالبة إنهاء واحدة، مراجعة تُطبَّق مرة، تحويل صرف واحد يفوز، عدادات = سجل النقرات) ومربوطة بـCI مع خدمة `postgres:16`. محليًا: لا PostgreSQL مثبّت، ومحرك Docker لم يعمل على هذا الجهاز (Docker Desktop قائم لكن لا engine)، وسياسة Application Control تمنع الملفات الثنائية الأصلية. بديلي كان PGlite (Postgres حقيقي بـWASM) لإثبات كل مسارات SQL الخاصة بـPostgreSQL، لكنه أحادي الاتصال فلا يثبت التزامن بين العمليات. **قبل الاعتماد على الجوائز الكبيرة: شغّل `npm run test:pg` على Docker/خادم اختبار** (الأمر في PRODUCTION_CHECKLIST.md §F).
2. **اختبار متصفح كامل:** الفحص عبر HTTP حقيقي تحقق من HTML والرؤوس ورمز التحقق، لكن لم يُشغَّل متصفح حقيقي ينفّذ `/go-challenge.js` ضد بناء الإنتاج آليًا (التدفق نفسه جُرّب يدويًا سابقًا في المتصفح المحلي).
3. **إرسال البريد الحقيقي:** موصل `resend` جاهز عبر HTTP لكنه غير مُختبر ببيانات حقيقية (لا مفتاح). بدون `MAIL_PROVIDER=resend` لا تُرسل رسائل — تُخزَّن في `mail_outbox` فقط ولا تُشترط لتأكيد البريد.
4. **الملحق التاريخي:** أيام الإحصائيات اليومية قبل هذا الإصدار مفتاحها UTC والجديدة بتوقيت الرياض؛ الحملة الحالية القصيرة يقلّل أثر ذلك ويمكن إعادة بناء `campaign_daily_stats` من `clicks` عند الحاجة.
5. **ما لا يدّعيه النظام:** الزيارة المؤهلة تحويل اجتاز الفلاتر — ليست إثباتًا لبشرية الزائر أو لتحميل صفحة المتجر أو لشراء؛ التسميات عُدّلت وفق ذلك.

## 5) متغيرات البيئة والخطوات قبل النشر (النشر يفشل بدونها عمدًا)
**Vercel → Environment Variables (Production):**
`DATABASE_URL` (بدور `app_runtime` عبر pooler 6543)، `SESSION_SECRET` (≥32)، `CHALLENGE_SECRET` (≥32، مختلف)، `IP_HASH_SALT` (≥16)، `MFA_ENCRYPTION_KEY` (base64 لـ32 بايت)، `NEXT_PUBLIC_APP_URL=https://www.creatorarena.agency`، `REGISTRATION_MODE=pending_approval`، واختياريًا `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM`.
**لا تضع** `MIGRATION_DATABASE_URL` أو `TEST_DATABASE_URL` في Vercel.

**Supabase (يدويًا، بالترتيب):**
1. `MIGRATION_DATABASE_URL=<اتصال المالك> CONFIRM_PROD_WRITE=I_UNDERSTAND ADMIN_PASSWORD=<قوية> npm run db:push` (إضافي فقط، قابل للتكرار).
2. تشغيل `migrations/0001_deny_by_default.sql` من SQL editor بعد مراجعته.
3. `ALTER ROLE app_runtime PASSWORD '...'` في SQL editor، ثم تحديث `DATABASE_URL` في Vercel.
4. `PGURL=<اتصال المالك> CONFIRM_PROD_ACCESS=I_UNDERSTAND npm run db:check` → `ALL CHECKS PASSED`.

**بعد النشر:** أول دخول للأدمن يفرض تفعيل MFA — جهّز تطبيق مصادقة واحفظ رموز الاستعادة؛ غيّر كلمة مرور الأدمن؛ اعتمد الحسابات الجديدة من لوحة الصناع؛ ثبّت نتائج أي حملة منتهية بعد مراجعة الزيارات المعلقة قبل اعتماد الجوائز. تفاصيل أوسع في `PRODUCTION_CHECKLIST.md` و`SECURITY.md` و`INCIDENT_RESPONSE.md`.
