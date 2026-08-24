import Link from "next/link";
import { listActiveCampaigns, type MarketplaceSort } from "@/services/campaigns";
import { CampaignCard } from "@/components/campaign-card";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const SORTS: { key: MarketplaceSort; label: string }[] = [
  { key: "newest", label: "الأحدث" },
  { key: "prize", label: "أعلى جائزة" },
  { key: "ending", label: "الأقرب للانتهاء" },
  { key: "popular", label: "الأكثر مشاركة" },
];

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
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold text-white">التحديات النشطة 🔥</h1>
      <p className="mt-1 text-zinc-400">اختر تحديًا، انسخ رابطك، وابدأ المنافسة</p>

      <div className="mt-6 flex flex-wrap gap-2">
        {SORTS.map((s) => (
          <Link
            key={s.key}
            href={`/campaigns?sort=${s.key}`}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
              s.key === sort
                ? "bg-brand-600 text-white"
                : "border border-white/15 bg-[#17171C] text-zinc-400 hover:bg-white/5"
            )}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {campaigns.length === 0 ? (
        <div className="mt-16 text-center">
          <p className="text-5xl">🕰️</p>
          <p className="mt-4 text-lg font-bold text-zinc-300">لا توجد تحديات نشطة حاليًا</p>
          <p className="mt-1 text-zinc-400">سجّل الآن وسيصلك إشعار عند إطلاق أول تحدٍّ جديد.</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => (
            <CampaignCard key={c.id} campaign={c} />
          ))}
        </div>
      )}
    </div>
  );
}
