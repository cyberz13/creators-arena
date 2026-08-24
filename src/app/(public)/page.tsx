import Link from "next/link";
import { ArrowLeft, ChartNoAxesColumn, Link2, Megaphone, Sparkles, Trophy, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CampaignCard } from "@/components/campaign-card";
import { listActiveCampaigns } from "@/services/campaigns";

export const dynamic = "force-dynamic";

const STEPS = [
  { icon: Users, title: "انضم للتحدي", desc: "سجل كصانع محتوى واختر الحملة المناسبة لجمهورك." },
  { icon: Link2, title: "انسخ رابطك الخاص", desc: "لكل حملة رابط تتبع فريد باسمك." },
  { icon: Megaphone, title: "شاركه مع جمهورك", desc: "تيك توك، إنستقرام، سناب — أينما كان جمهورك." },
  { icon: ChartNoAxesColumn, title: "تابع ترتيبك مباشرة", desc: "Leaderboard حي يحسب الزيارات الحقيقية فقط." },
  { icon: Trophy, title: "تصدّر واربح", desc: "صاحب أكبر عدد زيارات مؤهلة يفوز بالجائزة." },
];

export default async function HomePage() {
  const campaigns = (await listActiveCampaigns("prize")).slice(0, 3);
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden bg-[#08080A] text-white">
        <div className="absolute inset-0 [background-image:radial-gradient(circle_at_20%_10%,rgba(139,92,246,0.35)_0,transparent_45%),radial-gradient(circle_at_85%_80%,rgba(245,158,11,0.2)_0,transparent_40%)]" />
        <div className="relative mx-auto max-w-6xl px-4 py-20 text-center sm:py-28">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm text-brand-200">
            <Sparkles className="size-4" />
            لصناع المحتوى في السعودية
          </span>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight sm:text-6xl">
            نافس. اجلب الزيارات.
            <span className="bg-gradient-to-l from-amber-300 to-amber-500 bg-clip-text text-transparent"> واربح 🏆</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-zinc-400">
            شارك في تحديات المتاجر الإلكترونية، نافس صناع المحتوى، واجلب أكبر عدد من الزيارات
            للفوز بالجوائز. لا تحتاج ملايين المتابعين — تحتاج جمهورًا حقيقيًا.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/campaigns">
              <Button size="lg" variant="gold" className="w-full sm:w-auto">
                شاهد التحديات
                <ArrowLeft className="size-4" />
              </Button>
            </Link>
            <Link href="/register">
              <Button
                size="lg"
                variant="outline"
                className="w-full border-white/20 bg-white/5 text-white hover:bg-white/10 sm:w-auto"
              >
                انضم كصانع محتوى
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-3xl font-bold text-white">كيف تعمل المنصة؟</h2>
        <p className="mt-2 text-center text-zinc-400">خمس خطوات تفصلك عن جائزتك الأولى</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((s, i) => (
            <Card key={s.title} className="relative p-5 text-center">
              <span className="absolute right-4 top-4 text-xs font-bold text-zinc-400">{i + 1}</span>
              <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand-500/10 text-brand-400">
                <s.icon className="size-6" />
              </div>
              <h3 className="mt-3 font-bold text-white">{s.title}</h3>
              <p className="mt-1 text-sm text-zinc-400">{s.desc}</p>
            </Card>
          ))}
        </div>
      </section>

      {/* Live campaigns */}
      {campaigns.length > 0 && (
        <section className="bg-[#17171C] py-16">
          <div className="mx-auto max-w-6xl px-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-white">تحديات مشتعلة الآن 🔥</h2>
                <p className="mt-1 text-zinc-400">جوائز حقيقية بانتظار المتصدرين</p>
              </div>
              <Link href="/campaigns" className="text-sm font-bold text-brand-400 hover:text-brand-300">
                كل التحديات ←
              </Link>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {campaigns.map((c) => (
                <CampaignCard key={c.id} campaign={c} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Why */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold text-white">لا تحتاج عددًا ضخمًا من المتابعين</h2>
            <p className="mt-3 text-lg text-zinc-400">
              المنافسة على الزيارات الحقيقية، وليس على حجم الحساب. جمهور صغير ومتفاعل قد
              يتفوق على حساب ضخم وخامل.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                "نظام تتبع دقيق يحتسب الزيارات الحقيقية فقط",
                "Leaderboard مباشر يتحدث لحظة بلحظة",
                "حماية من التلاعب والزيارات الوهمية",
                "جوائز نقدية تصرف بعد نهاية كل تحدي",
              ].map((f) => (
                <li key={f} className="flex items-center gap-3 text-zinc-300">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-xs text-emerald-300">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <Link href="/register" className="mt-8 inline-block">
              <Button size="lg">ابدأ المنافسة الآن</Button>
            </Link>
          </div>
          <Card className="p-6">
            <p className="mb-4 font-bold text-white">🏆 Leaderboard — تحدي متجر لمسة</p>
            {[
              ["🥇", "sara.style", "2,431"],
              ["🥈", "noura_vlogs", "2,182"],
              ["🥉", "reem.daily", "1,874"],
              ["#4", "faisal.tech", "1,641"],
            ].map(([m, u, v]) => (
              <div key={u} className="flex items-center justify-between border-b border-white/[0.06] py-3 last:border-0">
                <span className="flex items-center gap-3">
                  <span className="w-8 text-center font-bold">{m}</span>
                  <span className="font-semibold text-zinc-200">@{u}</span>
                </span>
                <span className="tabular font-bold text-white">{v} <span className="text-xs font-normal text-zinc-500">زيارة</span></span>
              </div>
            ))}
            <p className="mt-4 rounded-xl bg-brand-500/10 p-3 text-sm font-semibold text-brand-300">
              🔥 أنت الآن #4 — تحتاج 234 زيارة لتتجاوز المركز الثالث
            </p>
          </Card>
        </div>
      </section>
    </div>
  );
}
