import { requireCreator } from "@/lib/auth";
import { creatorHomeStats, listCategories } from "@/services/creators";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/avatar";
import { formatNumber, formatSAR } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "ملفي" };

export default async function ProfilePage() {
  const user = await requireCreator();
  const profile = user.profile!;
  const [stats, categories] = await Promise.all([creatorHomeStats(user.id), listCategories()]);
  const category = categories.find((c) => c.id === profile.category_id);

  const socials = [
    { label: "TikTok", value: profile.tiktok },
    { label: "Instagram", value: profile.instagram },
    { label: "Snapchat", value: profile.snapchat },
  ].filter((s) => s.value);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-4">
          <Avatar name={profile.name} size="lg" />
          <div>
            <h1 className="text-xl font-bold text-white">{profile.name}</h1>
            <p className="text-sm text-zinc-400" dir="ltr">@{profile.username}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {category && <Badge variant="brand">{category.name_ar}</Badge>}
              <Badge>{formatNumber(profile.followers_count)} متابع</Badge>
            </div>
          </div>
        </div>
        {socials.length > 0 && (
          <div className="mt-5 grid gap-2 border-t border-white/[0.06] pt-4 sm:grid-cols-3">
            {socials.map((s) => (
              <div key={s.label} className="rounded-xl bg-white/5 p-3 text-center">
                <p className="text-xs text-zinc-500">{s.label}</p>
                <p className="truncate text-sm font-bold text-zinc-200" dir="ltr">{s.value}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["الحملات", formatNumber(stats.totalCampaigns)],
          ["الزيارات المؤهلة", formatNumber(stats.totalQualified)],
          ["مرات الفوز", formatNumber(stats.wins)],
          ["إجمالي الجوائز", formatSAR(stats.totalPrizes)],
        ].map(([label, value]) => (
          <Card key={label} className="p-4 text-center">
            <p className="tabular text-xl font-bold text-white">{value}</p>
            <p className="mt-0.5 text-xs text-zinc-400">{label}</p>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <p className="text-sm font-semibold text-zinc-300">البريد الإلكتروني</p>
        <p className="mt-1 text-sm text-zinc-400" dir="ltr">{user.email}</p>
      </Card>
    </div>
  );
}
