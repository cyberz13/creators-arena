import Link from "next/link";
import { listCreators, listCategories } from "@/services/creators";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/avatar";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "صناع المحتوى" };

export default async function AdminCreatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cat?: string; followers?: string }>;
}) {
  const { q: search, cat, followers } = await searchParams;
  const creators = await listCreators({
    search: search || undefined,
    categoryId: cat || undefined,
    minFollowers: followers ? Number(followers) : undefined,
  });
  const categories = await listCategories();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">صناع المحتوى</h1>
        <p className="mt-1 text-sm text-zinc-400">{formatNumber(creators.length)} حساب — مرتبون حسب الأداء الفعلي</p>
      </div>

      <form className="flex flex-wrap gap-2">
        <Input name="q" defaultValue={search} placeholder="بحث بالاسم أو اليوزر أو البريد" className="w-full sm:w-64" />
        <Select name="cat" defaultValue={cat ?? ""} className="w-full sm:w-44">
          <option value="">كل التصنيفات</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name_ar}</option>
          ))}
        </Select>
        <Select name="followers" defaultValue={followers ?? ""} className="w-full sm:w-44">
          <option value="">كل الأحجام</option>
          <option value="1000">+1,000 متابع</option>
          <option value="5000">+5,000 متابع</option>
          <option value="10000">+10,000 متابع</option>
        </Select>
        <Button type="submit" variant="secondary">تصفية</Button>
      </form>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-xs text-zinc-500">
              {["Creator", "التصنيف", "المتابعون", "الحملات", "زيارات مؤهلة", "فوز", "الحالة"].map((h) => (
                <th key={h} className="px-4 py-3 text-start font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {creators.map((c) => (
              <tr key={c.user_id} className="hover:bg-white/5">
                <td className="px-4 py-3">
                  <Link href={`/admin/creators/${c.user_id}`} className="flex items-center gap-2.5">
                    <Avatar name={c.name} size="sm" />
                    <span>
                      <span className="block font-bold text-white">@{c.username}</span>
                      <span className="block text-xs text-zinc-500">{c.name}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3 text-zinc-400">{c.category_name ?? "—"}</td>
                <td className="tabular px-4 py-3">{formatNumber(c.followers_count)}</td>
                <td className="tabular px-4 py-3">{formatNumber(c.campaigns_count)}</td>
                <td className="tabular px-4 py-3 font-bold text-emerald-300">{formatNumber(c.qualified_total)}</td>
                <td className="tabular px-4 py-3">{c.wins > 0 ? `🏆 ${formatNumber(c.wins)}` : "—"}</td>
                <td className="px-4 py-3">
                  {c.status === "active" ? (
                    <Badge variant="success">نشط</Badge>
                  ) : (
                    <Badge variant="danger">معطّل</Badge>
                  )}
                </td>
              </tr>
            ))}
            {creators.length === 0 && (
              <tr><td colSpan={7} className="py-8 text-center text-zinc-500">لا نتائج</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
