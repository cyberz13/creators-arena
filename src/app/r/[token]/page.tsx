import { notFound } from "next/navigation";
import { getCampaignByReportToken, buildStoreReport } from "@/services/store-report";
import { formatDate, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "تقرير الوصول الموثق",
  robots: { index: false, follow: false },
};

const SOURCE_LABELS: Record<string, string> = {
  tiktok: "تيك توك",
  instagram: "انستقرام",
  snapchat: "سناب شات",
  direct: "مباشر",
  other: "أخرى",
};

const STATUS_LABELS: Record<string, string> = {
  active: "نشطة الآن",
  ended: "منتهية",
  scheduled: "مجدولة",
  draft: "مسودة",
  cancelled: "ملغاة",
};

function Bar({ value, max, label, count }: { value: number; max: number; label: string; count: number }) {
  const width = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 truncate text-sm text-zinc-300">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${width}%` }} />
      </div>
      <span className="tabular w-12 shrink-0 text-end text-sm font-bold text-white">
        {formatNumber(count)}
      </span>
    </div>
  );
}

export default async function StoreReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const campaign = await getCampaignByReportToken(token);
  if (!campaign) notFound();
  const report = await buildStoreReport(campaign.id);

  const daily = report.daily.slice(-30);
  const dailyMax = Math.max(1, ...daily.map((d) => d.qualified));
  const cityMax = Math.max(1, ...report.cities.map((c) => c.count));
  const sourceMax = Math.max(1, ...report.sources.map((s) => s.count));
  const hourMax = Math.max(1, ...report.hours);
  const peakHour = report.hours.indexOf(Math.max(...report.hours));

  const kpis: [string, string, string][] = [
    ["زيارة موثقة", formatNumber(report.qualified), "عملاء حقيقيون وصلوا لمتجرك"],
    ["جهاز فريد", formatNumber(report.uniqueDevices), "أشخاص مختلفون فعليًا"],
    ["صانع محتوى", formatNumber(report.creators), "يروجون لمتجرك في الحملة"],
    ["محاولة مشبوهة صُدَّت", formatNumber(report.blocked), "زيارات مزيفة لم نحسبها لك"],
  ];

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      {/* Header */}
      <header className="border-b border-white/10 pb-6">
        <p className="text-sm font-bold tracking-[0.2em] text-zinc-400">
          CREATORS <span className="text-brand-400">ARENA</span>
        </p>
        <h1 className="mt-3 text-2xl font-bold text-white sm:text-3xl">تقرير الوصول الموثق</h1>
        <p className="mt-2 text-zinc-300">
          {campaign.store_name} — {campaign.title}
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          {formatDate(campaign.start_at)} ← {formatDate(campaign.end_at)} •{" "}
          {STATUS_LABELS[campaign.status] ?? campaign.status}
        </p>
      </header>

      {/* KPIs */}
      <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map(([label, value, hint]) => (
          <div key={label} className="rounded-2xl border border-white/[0.08] bg-surface p-4">
            <p className="tabular text-2xl font-bold text-white">{value}</p>
            <p className="mt-1 text-sm font-semibold text-zinc-300">{label}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>
          </div>
        ))}
      </section>

      {/* Daily qualified visits */}
      <section className="mt-8 rounded-2xl border border-white/[0.08] bg-surface p-5">
        <h2 className="font-bold text-white">الزيارات الموثقة يوميًا</h2>
        {daily.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">لا بيانات بعد</p>
        ) : (
          <>
            <div className="mt-4 flex h-32 items-end gap-1" dir="ltr">
              {daily.map((d) => (
                <div
                  key={d.day}
                  title={`${d.day}: ${d.qualified}`}
                  className="flex-1 rounded-t bg-brand-500/80"
                  style={{ height: `${Math.max(2, Math.round((d.qualified / dailyMax) * 100))}%` }}
                />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-xs text-zinc-500" dir="ltr">
              <span>{daily[0].day}</span>
              <span>{daily[daily.length - 1].day}</span>
            </div>
          </>
        )}
      </section>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {/* Cities */}
        <section className="rounded-2xl border border-white/[0.08] bg-surface p-5">
          <h2 className="font-bold text-white">أين عملاؤك الجدد؟</h2>
          <div className="mt-4 space-y-3">
            {report.cities.length === 0 ? (
              <p className="py-4 text-center text-sm text-zinc-500">
                الجغرافيا تُجمع للزيارات الجديدة أولًا بأول
              </p>
            ) : (
              report.cities.map((c) => (
                <Bar key={c.city} label={c.city} value={c.count} max={cityMax} count={c.count} />
              ))
            )}
          </div>
        </section>

        {/* Sources */}
        <section className="rounded-2xl border border-white/[0.08] bg-surface p-5">
          <h2 className="font-bold text-white">من أي منصة وصلوا؟</h2>
          <div className="mt-4 space-y-3">
            {report.sources.length === 0 ? (
              <p className="py-4 text-center text-sm text-zinc-500">لا بيانات بعد</p>
            ) : (
              report.sources.map((s) => (
                <Bar
                  key={s.source}
                  label={SOURCE_LABELS[s.source] ?? s.source}
                  value={s.count}
                  max={sourceMax}
                  count={s.count}
                />
              ))
            )}
          </div>
        </section>
      </div>

      {/* Peak hours */}
      <section className="mt-4 rounded-2xl border border-white/[0.08] bg-surface p-5">
        <h2 className="font-bold text-white">
          أوقات الذروة
          {report.qualified > 0 && (
            <span className="mr-2 text-sm font-normal text-zinc-400">
              — ذروة الوصول حوالي الساعة {peakHour}:00 بتوقيت الرياض
            </span>
          )}
        </h2>
        <div className="mt-4 flex h-20 items-end gap-1" dir="ltr">
          {report.hours.map((h, i) => (
            <div
              key={i}
              title={`${i}:00 — ${h}`}
              className={`flex-1 rounded-t ${i === peakHour && h > 0 ? "bg-brand-400" : "bg-brand-500/50"}`}
              style={{ height: `${Math.max(3, Math.round((h / hourMax) * 100))}%` }}
            />
          ))}
        </div>
        <div className="mt-2 flex justify-between text-xs text-zinc-500" dir="ltr">
          {["0:00", "6:00", "12:00", "18:00", "23:00"].map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      </section>

      {/* Top creators */}
      {report.topCreators.length > 0 && (
        <section className="mt-4 rounded-2xl border border-white/[0.08] bg-surface p-5">
          <h2 className="font-bold text-white">أبرز من أوصل العملاء إليك</h2>
          <div className="mt-4 space-y-2">
            {report.topCreators.map((c, i) => (
              <div key={c.username} className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-2.5">
                <span className="font-semibold text-zinc-200">
                  <span className="ml-2 text-zinc-500">#{i + 1}</span>@{c.username}
                </span>
                <span className="tabular text-sm font-bold text-brand-300">
                  {formatNumber(c.qualified_count)} زيارة
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="mt-10 border-t border-white/10 pt-5 text-xs leading-relaxed text-zinc-500">
        كل زيارة في هذا التقرير اجتازت تحققًا متعدد الطبقات (بشرية المتصفح، بصمة جهاز فريدة، فحص
        الشبكات المشبوهة) — الزيارات المكررة والمزيفة تُستبعد ولا تُحتسب. أُنشئ التقرير آليًا من
        بيانات المنصة الحية بتاريخ {formatDate(Date.now())}.
      </footer>
    </main>
  );
}
