import Link from "next/link";
import { listActiveCampaigns, type CampaignWithStats, type MarketplaceSort } from "@/services/campaigns";
import { SpotCard } from "@/components/landing/spot-card";
import { cn, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "التحديات" };

const SORTS: { key: MarketplaceSort; label: string }[] = [
  { key: "newest", label: "الأحدث" },
  { key: "prize", label: "أعلى جائزة" },
  { key: "ending", label: "الأقرب للانتهاء" },
  { key: "popular", label: "الأكثر مشاركة" },
];

function CampaignCover({ c }: { c: CampaignWithStats }) {
  if (c.image_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={c.image_url} alt="" className="h-full w-full object-cover" />;
  }
  return (
    <div className="grid h-full w-full place-items-center bg-[linear-gradient(135deg,#2b2741,#232532_60%)]">
      <span className="grid size-13 place-items-center rounded-2xl bg-brand-500/15 text-xl font-bold text-brand-300">
        {c.store_name.trim().charAt(0)}
      </span>
    </div>
  );
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort: rawSort } = await searchParams;
  const sort: MarketplaceSort = SORTS.some((s) => s.key === rawSort)
    ? (rawSort as MarketplaceSort)
    : "newest";
  const campaigns = await listActiveCampaigns(sort);

  return (
    <section className="mx-auto max-w-[1160px] px-6 pb-24 pt-16 sm:pt-20">
      <h6 className="text-[13px] font-semibold tracking-[0.04em] text-brand-500 [animation:rise_.7s_both]">التحديات</h6>
      <h1 className="mt-3 text-[38px] font-semibold tracking-[-0.02em] [animation:rise_.8s_.1s_both] sm:text-[48px]">اختر ساحتك</h1>
      <p className="mt-4 max-w-[44ch] text-base leading-[1.8] text-zinc-400 [animation:rise_.8s_.2s_both]">
        كل تحدٍّ مرتبط بمتجر حقيقي وجائزة معلنة. تُحسب الزيارات المؤهّلة فقط — لا نقرات وهمية.
      </p>

      <div className="mt-8 flex flex-wrap gap-2 [animation:rise_.8s_.3s_both]">
        {SORTS.map((s) => (
          <Link
            key={s.key}
            href={`/campaigns?sort=${s.key}`}
            className={cn(
              "rounded-md px-3 py-1 text-[12px] tracking-[0.02em] transition-colors",
              s.key === sort
                ? "bg-brand-800 text-brand-100"
                : "border border-brand-500 text-brand-500 hover:bg-brand-500/10"
            )}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {campaigns.length === 0 ? (
        <div className="mt-10 rounded-2xl bg-surface p-12 text-center shadow-[0_0_0_1px_#3f424d] [animation:rise_.8s_.35s_both]">
          <p className="text-4xl">🕰️</p>
          <p className="mt-4 text-lg font-semibold text-zinc-300">لا تحديات مفتوحة حالياً</p>
          <p className="mt-1.5 text-sm text-zinc-500">سجّل الآن وسيصلك إشعار عند انطلاق أول تحدٍّ جديد.</p>
          <Link
            href="/register"
            className="mt-6 inline-block rounded-lg border border-brand-500 px-5 py-2.5 text-sm font-medium text-brand-500 hover:bg-brand-500/10"
          >
            انضم كصانع محتوى
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-4.5 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => (
            <Link key={c.id} href={`/campaigns/${c.id}`} className="reveal block">
              <SpotCard className="flex h-full flex-col rounded-2xl bg-surface shadow-[0_0_0_1px_#3f424d] transition-shadow hover:shadow-[0_0_0_1px_#595d6c,0_6px_18px_rgba(0,0,0,0.55)]">
                <div className="h-[140px] overflow-hidden rounded-t-2xl bg-zinc-800">
                  <CampaignCover c={c} />
                </div>
                <div className="relative flex flex-1 flex-col gap-2.5 p-4.5">
                  <div className="flex items-center justify-between gap-2.5">
                    <span className="text-xs text-zinc-500">{c.store_name}</span>
                    <span className="rounded-md bg-brand-800 px-2.5 py-0.5 text-[11px] text-brand-100">
                      {c.end_at - Date.now() < 48 * 3_600_000 ? "ينتهي قريباً" : "مفتوح"}
                    </span>
                  </div>
                  <h4 className="text-lg font-semibold">{c.title}</h4>
                  <p className="flex-1 text-[13px] leading-[1.7] text-zinc-400">{c.description}</p>
                  <div className="flex items-center justify-between gap-3 border-t border-[var(--divider)] pt-3.5">
                    <span className="text-lg font-semibold">
                      <span className="num">{formatNumber(c.prize_total)}</span> ر.س
                    </span>
                    <span className="rounded-lg border border-[var(--divider)] px-3.5 py-1.5 text-[12.5px] text-zinc-300">
                      <span className="num">{formatNumber(c.participants_count)}</span> متسابق · شارك ←
                    </span>
                  </div>
                </div>
              </SpotCard>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
