import Link from "next/link";
import { listActiveCampaigns, type CampaignWithStats } from "@/services/campaigns";
import { getLeaderboard } from "@/services/leaderboard";
import { publicStats, topCreators } from "@/services/analytics";
import { LiveBoard } from "@/components/landing/live-board";
import { SpotCard } from "@/components/landing/spot-card";
import { CountUp } from "@/components/landing/count-up";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STEPS = [
  { n: "01", title: "انضم للتحدي", desc: "سجّل كصانع محتوى واختر الحملة الأقرب لجمهورك." },
  { n: "02", title: "خُذ رابطك", desc: "لكل حملة رابط تتبّع فريد باسمك وحدك." },
  { n: "03", title: "انشره بأسلوبك", desc: "تيك توك، إنستقرام، سناب — أينما كان جمهورك." },
  { n: "04", title: "تابع ترتيبك", desc: "لوحة متصدرين حيّة تحسب الزيارات الحقيقية فقط." },
  { n: "05", title: "تصدّر واربح", desc: "صاحب أكبر عدد زيارات مؤهّلة يأخذ الجائزة." },
];

const QUOTES = [
  { initial: "R", handle: "@reem.daily", meta: "فائزة تحدي سِدر", text: "أول تحدٍّ شاركت فيه كان بعشرين ألف متابع فقط — وربحت. المهم هنا الجمهور الحقيقي لا الرقم." },
  { initial: "A", handle: "@abdullah.tech", meta: "المركز الثاني · موسم مارس", text: "الشفافية هي الفرق: أرى زياراتي وترتيبي لحظة بلحظة، فأعرف بالضبط ماذا أعدّل في المحتوى." },
  { initial: "L", handle: "@lamia.home", meta: "٤ تحديات مكتملة", text: "بدلاً من انتظار عرض من علامة تجارية، أدخل الساحة متى شئت وأنافس على جائزة معلنة." },
];

const FAQS = [
  { q: "هل التسجيل مجاني؟", a: "نعم، الانضمام والمشاركة في التحديات مجانيان تماماً. لا عمولة على جوائزك." },
  { q: "كم عدد المتابعين المطلوب؟", a: "لا يوجد حد أدنى صارم. نراجع نسبة التفاعل وجودة الجمهور أكثر من الرقم نفسه." },
  { q: "كيف تُحسب الزيارة المؤهّلة؟", a: "زيارة من جهاز حقيقي عبر رابطك الخاص. الزيارات المكررة من نفس المصدر والنقرات الآلية تُستبعد تلقائياً بنظام كشف التلاعب." },
  { q: "متى تُصرف الجوائز؟", a: "خلال سبعة أيام عمل من إعلان النتائج النهائية للتحدي." },
  { q: "هل أشارك في أكثر من تحدٍّ؟", a: "نعم، يمكنك المنافسة في عدة تحديات في وقت واحد، وترتيب الموسم يجمع نتائجك كلها." },
];

function CampaignCover({ c }: { c: CampaignWithStats }) {
  if (c.image_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={c.image_url} alt="" className="h-full w-full object-cover" />;
  }
  return (
    <div className="grid h-full w-full place-items-center bg-[linear-gradient(135deg,#2b2741,#232532_60%)]">
      <span className="grid size-14 place-items-center rounded-2xl bg-brand-500/15 text-2xl font-bold text-brand-300">
        {c.store_name.trim().charAt(0)}
      </span>
    </div>
  );
}

function statusLabel(c: CampaignWithStats): string {
  return c.end_at - Date.now() < 48 * 3_600_000 ? "ينتهي قريباً" : "مفتوح";
}

export default async function HomePage() {
  const [stats, active, faces] = await Promise.all([
    publicStats(),
    listActiveCampaigns("popular"),
    topCreators(4),
  ]);
  const featured = [...active].sort((a, b) => b.prize_total - a.prize_total).slice(0, 3);
  const liveCampaign = active[0] ?? null;
  const liveBoard = liveCampaign ? await getLeaderboard(liveCampaign.id, 4) : [];

  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          <div className="absolute -inset-10 opacity-50 [background-image:linear-gradient(var(--divider)_1px,transparent_1px),linear-gradient(90deg,var(--divider)_1px,transparent_1px)] [background-size:64px_64px] [animation:gridPan_14s_linear_infinite] [mask-image:radial-gradient(120%_80%_at_70%_20%,#000_10%,transparent_72%)]" />
          <div className="absolute top-[8%] right-[6%] hidden h-[520px] w-[520px] rounded-full border border-[var(--divider)] [animation:orbit_40s_linear_infinite] lg:block">
            <span className="absolute -top-1 left-1/2 size-2 rounded-full bg-brand-500 shadow-[0_0_18px_4px_color-mix(in_srgb,#9184d9_55%,transparent)]" />
          </div>
          <div className="absolute top-[18%] right-[14%] hidden h-[340px] w-[340px] rounded-full border border-[var(--divider)] [animation:orbit_26s_linear_infinite_reverse] lg:block">
            <span className="absolute -bottom-[3px] left-[30%] size-1.5 rounded-full bg-brand-300 shadow-[0_0_14px_3px_color-mix(in_srgb,#9184d9_45%,transparent)]" />
          </div>
        </div>

        <div className="relative z-10 mx-auto grid max-w-[1160px] items-center gap-10 px-6 pb-16 pt-16 sm:pt-20 lg:grid-cols-[1.05fr_.95fr] lg:gap-14 lg:pb-17 lg:pt-23">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--divider)] px-3.5 py-1.5 text-[12.5px] text-brand-300 [animation:rise_.7s_.05s_both]">
              <span className="size-[7px] rounded-full bg-brand-500 [animation:pulseDot_2.4s_ease-out_infinite]" />
              حلقة المنافسة مفتوحة الآن
            </span>
            <h1 className="mt-6 text-[44px] font-bold leading-[1.1] tracking-[-0.03em] sm:text-[58px] lg:text-[68px]">
              <span className="inline-block [animation:wordIn_.8s_.12s_both]">نافس.</span>{" "}
              <span className="inline-block [animation:wordIn_.8s_.26s_both]">اجلب</span>
              <span className="block bg-[linear-gradient(90deg,#e9e9ed_0%,#e9e9ed_30%,#f5f4ff_45%,#e9e9ed_62%,#e9e9ed_100%)] bg-[length:220%_100%] bg-clip-text text-transparent [animation:wordIn_.8s_.4s_both,shine_6s_1.4s_linear_infinite]">
                الزيارات الحقيقية.
              </span>
              <span className="relative inline-flex items-center gap-1 text-brand-500 [animation:wordIn_.8s_.56s_both]">
                واربح
                <span className="h-[0.72em] w-[3px] bg-brand-500 [animation:caret_1.1s_1.4s_step-end_infinite]" />
                <span className="absolute inset-x-0 -bottom-2 h-0.5 origin-right bg-brand-500 [animation:barGrow_.9s_1.1s_both]" />
              </span>
            </h1>
            <p className="mt-7 max-w-[34ch] text-[17px] leading-[1.75] text-zinc-400 [animation:rise_.8s_.7s_both] [text-wrap:pretty]">
              ساحة تنافس بين صنّاع المحتوى: اختر تحدي متجر، انشر رابطك، واجلب أكبر عدد من
              الزيارات الحقيقية. لا تحتاج مليون متابع — تحتاج جمهوراً يثق بك.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 [animation:rise_.8s_.85s_both]">
              <Link
                href="/campaigns"
                className="rounded-lg border border-brand-500 px-5 py-3 text-[15px] font-medium text-brand-500 transition-colors hover:bg-brand-500/10"
              >
                شاهد التحديات ←
              </Link>
              <Link
                href="/register"
                className="rounded-lg border border-[var(--divider)] px-5 py-3 text-[15px] font-medium text-[#e9e9ed] transition-colors hover:bg-white/5"
              >
                ابدأ المنافسة
              </Link>
            </div>
            <div className="mt-11 flex gap-6 [animation:rise_.8s_1s_both] sm:gap-8">
              <div>
                <div className="text-[26px] font-semibold"><CountUp value={stats.creators} /></div>
                <div className="mt-1 text-xs text-zinc-500">صانع محتوى</div>
              </div>
              <div className="w-px bg-[var(--divider)]" />
              <div>
                <div className="text-[26px] font-semibold"><CountUp value={stats.endedCampaigns} /></div>
                <div className="mt-1 text-xs text-zinc-500">تحدياً مكتملاً</div>
              </div>
              <div className="w-px bg-[var(--divider)]" />
              <div>
                <div className="text-[26px] font-semibold"><CountUp value={stats.prizeMoney} /></div>
                <div className="mt-1 text-xs text-zinc-500">ريال جوائز</div>
              </div>
            </div>
          </div>

          <div className="[animation:rise_.9s_.45s_both]">
            <LiveBoard
              campaignId={liveCampaign?.id ?? null}
              campaignTitle={liveCampaign ? liveCampaign.title : "أول تحدٍّ ينطلق قريباً"}
              initial={liveBoard}
            />
          </div>
        </div>
      </section>

      {/* ── Steps ────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1160px] px-6 pt-20">
        <div className="reveal">
          <h6 className="text-[13px] font-semibold tracking-[0.04em] text-brand-500">كيف تعمل الساحة</h6>
          <h2 className="mt-3 max-w-[22ch] text-[30px] font-semibold leading-[1.25] sm:text-[38px]">
            خمس خطوات تفصلك عن جائزتك الأولى
          </h2>
        </div>
        <div className="relative mt-13 pt-11">
          <div className="absolute inset-x-[6%] top-[19px] hidden h-px bg-[var(--divider)] lg:block" />
          <div className="absolute inset-x-[6%] top-[19px] hidden h-px lg:block">
            <div className="reveal h-px origin-right bg-[linear-gradient(270deg,#9184d9,color-mix(in_srgb,#9184d9_15%,transparent))]" />
            <span className="absolute -top-[3px] size-[7px] rounded-full bg-brand-500 shadow-[0_0_16px_5px_color-mix(in_srgb,#9184d9_50%,transparent)] [animation:travel_7s_1.2s_cubic-bezier(.5,0,.5,1)_infinite]" />
          </div>
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
            {STEPS.map((s) => (
              <div key={s.n} className="reveal relative flex flex-col items-center">
                <span className="absolute -top-11 hidden size-[38px] place-items-center rounded-full bg-canvas shadow-[0_0_0_1px_var(--divider)] lg:grid">
                  <span className="num text-xs font-semibold text-brand-500">{s.n}</span>
                </span>
                <SpotCard className="w-full rounded-lg bg-surface p-5 shadow-[0_0_0_1px_#3f424d] transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_0_0_1px_#595d6c,0_6px_18px_rgba(0,0,0,0.55)]">
                  <div className="relative">
                    <h4 className="mb-2 text-[17px] font-semibold">
                      <span className="num me-2 text-xs text-brand-500 lg:hidden">{s.n}</span>
                      {s.title}
                    </h4>
                    <p className="text-[13px] leading-[1.75] text-zinc-400">{s.desc}</p>
                  </div>
                </SpotCard>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Stats band ───────────────────────────────────────── */}
      <section className="relative mt-20 overflow-hidden bg-section">
        <div className="absolute -top-[45%] right-[18%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,#353b80,transparent_66%)] blur-[22px] [animation:glowA_24s_ease-in-out_infinite]" />
        <div className="relative mx-auto grid max-w-[1160px] grid-cols-2 gap-y-10 px-6 py-14 sm:py-17 lg:grid-cols-4">
          {[
            { value: stats.creators, label: "صانع محتوى مسجّل", suffix: null },
            { value: stats.qualifiedVisits, label: "زيارة مؤهّلة", suffix: null },
            { value: stats.endedCampaigns, label: "تحدياً مكتملاً", suffix: "تحدياً" },
            { value: stats.prizeMoney, label: "جوائز بالريال", suffix: "ر.س" },
          ].map((s, i) => (
            <div
              key={s.label}
              className={`reveal flex flex-col items-start gap-3 ${i > 0 ? "lg:shadow-[inset_1px_0_0_0_color-mix(in_srgb,#f5f4ff_20%,transparent)] lg:ps-8" : ""} ${i > 0 && i % 2 === 1 ? "ps-8 shadow-[inset_1px_0_0_0_color-mix(in_srgb,#f5f4ff_20%,transparent)]" : ""}`}
            >
              <div className="flex items-baseline gap-2 leading-none">
                <CountUp value={s.value} className="text-[38px] font-semibold tracking-[-0.02em] sm:text-[46px]" />
                {s.suffix && i === 3 && <span className="text-xl text-brand-200">ر.س</span>}
              </div>
              <div className="h-0.5 w-7 origin-right bg-brand-300" />
              <div className="text-[13px] text-brand-200">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Featured campaigns ───────────────────────────────── */}
      <section className="mx-auto max-w-[1160px] px-6 pt-20">
        <div className="reveal flex flex-wrap items-end justify-between gap-5">
          <div>
            <h6 className="text-[13px] font-semibold tracking-[0.04em] text-brand-500">تحديات مشتعلة الآن</h6>
            <h2 className="mt-3 text-[30px] font-semibold sm:text-[38px]">جوائز حقيقية بانتظار المتصدّرين</h2>
          </div>
          <Link href="/campaigns" className="whitespace-nowrap text-sm font-medium text-brand-500 hover:text-brand-300">
            كل التحديات ←
          </Link>
        </div>
        {featured.length === 0 ? (
          <div className="reveal mt-9 rounded-2xl bg-surface p-10 text-center text-zinc-400 shadow-[0_0_0_1px_#3f424d]">
            لا تحديات مفتوحة هذه اللحظة — سجّل الآن لتكون أول من يعلم عند انطلاق التحدي القادم.
          </div>
        ) : (
          <div className="mt-9 grid gap-4.5 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((c) => (
              <Link key={c.id} href={`/campaigns/${c.id}`} className="reveal block">
                <SpotCard className="flex h-full flex-col rounded-2xl bg-surface shadow-[0_0_0_1px_#3f424d] transition-shadow hover:shadow-[0_0_0_1px_#595d6c,0_6px_18px_rgba(0,0,0,0.55)]">
                  <div className="h-[152px] overflow-hidden rounded-t-2xl bg-zinc-800">
                    <CampaignCover c={c} />
                  </div>
                  <div className="relative flex flex-1 flex-col gap-2.5 p-4.5">
                    <div className="flex items-center justify-between gap-2.5">
                      <span className="text-xs text-zinc-500">{c.store_name}</span>
                      <span className="rounded-md bg-brand-800 px-2.5 py-0.5 text-[11px] text-brand-100">{statusLabel(c)}</span>
                    </div>
                    <h4 className="text-lg font-semibold">{c.title}</h4>
                    <p className="flex-1 text-[13px] leading-[1.7] text-zinc-400">{c.description}</p>
                    <div className="flex items-end justify-between gap-3 border-t border-[var(--divider)] pt-3.5">
                      <div>
                        <div className="text-[11px] text-zinc-500">الجائزة</div>
                        <div className="mt-0.5 text-[19px] font-semibold">
                          <span className="num">{formatNumber(c.prize_total)}</span> ر.س
                        </div>
                      </div>
                      <div className="text-left">
                        <div className="text-[11px] text-zinc-500">متسابق</div>
                        <div className="num mt-0.5 text-[19px] font-semibold">{formatNumber(c.participants_count)}</div>
                      </div>
                    </div>
                  </div>
                </SpotCard>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── Faces of the arena ───────────────────────────────── */}
      {faces.length > 0 && (
        <section className="mx-auto max-w-[1160px] px-6 pt-20">
          <div className="reveal">
            <h6 className="text-[13px] font-semibold tracking-[0.04em] text-brand-500">وجوه الساحة</h6>
            <h2 className="mt-3 text-[30px] font-semibold sm:text-[38px]">صنّاع محتوى يتصدرون الساحة الآن</h2>
          </div>
          <div className="mt-9 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
            {faces.map((p) => (
              <div key={p.user_id} className="reveal overflow-hidden rounded-lg bg-surface shadow-[0_0_0_1px_#3f424d]">
                <div className="grid aspect-[3/2.2] place-items-center bg-[linear-gradient(150deg,#2b2741,#232532_70%)] lg:aspect-[3/2.6]">
                  <span className="grid size-16 place-items-center rounded-full bg-brand-500/15 text-2xl font-bold text-brand-300">
                    {p.name.trim().charAt(0)}
                  </span>
                </div>
                <div className="p-3">
                  <div dir="ltr" className="truncate text-right text-[13px] text-zinc-300">@{p.username}</div>
                  <div className="mt-1 text-[11px] text-zinc-500">
                    {p.category_name ?? "عام"} · <span className="num">{formatNumber(p.qualified_total)}</span> زيارة
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Quotes ───────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1160px] px-6 pt-20">
        <div className="grid gap-4.5 md:grid-cols-3">
          {QUOTES.map((q) => (
            <div key={q.handle} className="reveal flex flex-col gap-4.5 rounded-2xl bg-surface p-6 shadow-[0_0_0_1px_#3f424d]">
              <p className="flex-1 text-base leading-[1.8] [text-wrap:pretty]">{q.text}</p>
              <div className="flex items-center gap-3 border-t border-[var(--divider)] pt-4">
                <span className="grid size-[34px] flex-none place-items-center rounded-full bg-brand-900 text-[13px] font-semibold text-brand-200">
                  {q.initial}
                </span>
                <span>
                  <span dir="ltr" className="block text-right text-[13px] text-zinc-300">{q.handle}</span>
                  <span className="mt-0.5 block text-[11px] text-zinc-500">{q.meta}</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────── */}
      <section id="faq" className="mx-auto grid max-w-[1160px] items-start gap-8 px-6 pt-20 md:grid-cols-[.85fr_1.15fr] md:gap-14">
        <div className="reveal">
          <h6 className="text-[13px] font-semibold tracking-[0.04em] text-brand-500">الأسئلة الشائعة</h6>
          <h2 className="mt-3 text-[28px] font-semibold leading-[1.3] sm:text-[34px]">كل ما تريد معرفته قبل أول تحدٍّ</h2>
          <p className="mt-4 text-sm leading-[1.8] text-zinc-400">لم تجد سؤالك؟ فريق الساحة يرد خلال ساعات العمل.</p>
        </div>
        <div className="reveal flex flex-col">
          {FAQS.map((f) => (
            <details key={f.q} className="group px-0.5 py-4.5 shadow-[0_1px_0_0_var(--divider)]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold [&::-webkit-details-marker]:hidden">
                <span>{f.q}</span>
                <span className="text-xl leading-none text-brand-500 transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 max-w-[62ch] text-sm leading-[1.85] text-zinc-400">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── Join CTA ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1160px] px-6 py-24">
        <SpotCard className="grid items-center gap-10 rounded-2xl bg-surface p-8 shadow-[0_0_0_1px_#595d6c,0_6px_18px_rgba(0,0,0,0.55)] sm:p-11 lg:grid-cols-2 lg:gap-12">
          <div className="relative">
            <h2 className="text-[28px] font-semibold leading-[1.25] sm:text-[36px]">سجّل اليوم، نافس في أول تحدٍّ فوراً</h2>
            <p className="mt-4 max-w-[36ch] text-[15px] leading-[1.85] text-zinc-400">
              التسجيل مجاني بالكامل ويستغرق أقل من دقيقة — وبمجرد إنشاء حسابك تنفتح لك التحديات المتاحة.
            </p>
            <div className="mt-6 flex flex-col gap-2.5 text-sm text-zinc-300">
              <span className="flex items-center gap-2.5"><span className="size-1.5 rounded-full bg-brand-500" /> رابط تتبّع خاص لكل حملة</span>
              <span className="flex items-center gap-2.5"><span className="size-1.5 rounded-full bg-brand-500" /> لوحة إحصائيات مباشرة</span>
              <span className="flex items-center gap-2.5"><span className="size-1.5 rounded-full bg-brand-500" /> ترتيب شفاف وجوائز معلنة</span>
            </div>
          </div>
          <div className="relative flex flex-col items-center gap-4 rounded-2xl border border-[var(--divider)] p-8 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-brand-900 text-2xl">🏆</span>
            <p className="text-lg font-semibold">جاهز تدخل الساحة؟</p>
            <p className="text-sm text-zinc-400">حساب واحد يفتح كل التحديات الحالية والقادمة.</p>
            <Link
              href="/register"
              className="mt-2 w-full rounded-lg border border-brand-500 px-5 py-3 text-[15px] font-medium text-brand-500 transition-colors hover:bg-brand-500/10"
            >
              أنشئ حسابك الآن
            </Link>
            <Link href="/login" className="text-[13px] text-zinc-500 hover:text-brand-500">
              لديك حساب؟ سجّل دخولك
            </Link>
          </div>
        </SpotCard>
      </section>
    </div>
  );
}
