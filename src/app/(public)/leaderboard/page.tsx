import { topCreators } from "@/services/analytics";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "المتصدرون" };

export default async function SeasonBoardPage() {
  const season = await topCreators(20);
  const top = Math.max(1, ...season.map((r) => r.qualified_total));

  return (
    <section className="mx-auto max-w-[1000px] px-6 pb-24 pt-16 sm:pt-20">
      <h6 className="text-[13px] font-semibold tracking-[0.04em] text-brand-500 [animation:rise_.7s_both]">المتصدرون</h6>
      <h1 className="mt-3 text-[38px] font-semibold tracking-[-0.02em] [animation:rise_.8s_.1s_both] sm:text-[48px]">لوحة الشرف</h1>
      <p className="mt-4 max-w-[46ch] text-base leading-[1.8] text-zinc-400 [animation:rise_.8s_.2s_both]">
        الترتيب العام لصنّاع المحتوى، محسوباً بالزيارات المؤهّلة عبر جميع التحديات.
      </p>

      {season.length === 0 ? (
        <div className="mt-9 rounded-2xl bg-surface p-12 text-center text-zinc-400 shadow-[0_0_0_1px_#3f424d] [animation:rise_.8s_.3s_both]">
          الساحة تنتظر أول متنافس — سجّل وانضم لأول تحدٍّ لتظهر هنا.
        </div>
      ) : (
        <div className="mt-9 overflow-hidden rounded-2xl bg-surface shadow-[0_0_0_1px_#3f424d] [animation:rise_.8s_.3s_both]">
          {season.map((r, i) => {
            const pct = Math.round((r.qualified_total / top) * 100);
            return (
              <div
                key={r.user_id}
                className="flex items-center gap-3 px-4 py-4 shadow-[0_1px_0_0_var(--divider)] sm:gap-4 sm:px-5.5"
              >
                <span className="num w-7 text-center text-[15px] font-semibold text-brand-500">{i + 1}</span>
                <span className="grid size-9 flex-none place-items-center overflow-hidden rounded-full bg-brand-900 text-sm font-semibold text-brand-200">
                  {r.name.trim().charAt(0)}
                </span>
                <span className="min-w-0 flex-1">
                  <span dir="ltr" className="block truncate text-right text-[14.5px] text-zinc-200">@{r.username}</span>
                  <span className="mt-0.5 block text-[11.5px] text-zinc-500">
                    {r.category_name ?? "عام"}
                    {r.wins > 0 && <> · 🏆 <span className="num">{r.wins}</span></>}
                  </span>
                </span>
                <span className="hidden flex-[1.4] items-center gap-2.5 sm:flex">
                  <span className="h-[5px] flex-1 overflow-hidden rounded-full bg-zinc-800">
                    <span
                      className="reveal block h-full origin-right bg-brand-500"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="num w-16 text-left text-sm font-semibold">{formatNumber(r.qualified_total)}</span>
                </span>
                <span className="num text-sm font-semibold sm:hidden">{formatNumber(r.qualified_total)}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
