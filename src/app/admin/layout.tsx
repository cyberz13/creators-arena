import Link from "next/link";
import {
  Activity,
  Banknote,
  LayoutDashboard,
  Megaphone,
  MousePointerClick,
  Settings,
  Users,
} from "lucide-react";
import { LogoMark, LogoWordmark } from "@/components/logo";
import { requireAdmin } from "@/lib/auth";
import { logoutAction } from "@/app/actions/auth";

const NAV = [
  { href: "/admin", label: "نظرة عامة", icon: LayoutDashboard },
  { href: "/admin/campaigns", label: "الحملات", icon: Megaphone },
  { href: "/admin/creators", label: "صناع المحتوى", icon: Users },
  { href: "/admin/clicks", label: "مراجعة الزيارات", icon: MousePointerClick },
  { href: "/admin/payouts", label: "الجوائز", icon: Banknote },
  { href: "/admin/actions", label: "سجل الإجراءات", icon: Activity },
  { href: "/admin/settings", label: "الإعدادات", icon: Settings },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="min-h-dvh md:flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 shrink-0 flex-col border-e border-white/10 bg-surface md:flex">
        <div className="flex h-16 items-center gap-2.5 border-b border-white/[0.06] px-5">
          <LogoMark className="h-6" />
          <div>
            <LogoWordmark className="text-sm" />
            <p className="text-[11px] text-zinc-500">لوحة الإدارة</p>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 p-3">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <n.icon className="size-4" />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/[0.06] p-3">
          <form action={logoutAction}>
            <button className="w-full rounded-xl px-3 py-2.5 text-start text-sm font-semibold text-zinc-400 hover:bg-white/10">
              تسجيل الخروج
            </button>
          </form>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex-1">
        <header className="sticky top-0 z-40 border-b border-white/10 bg-canvas/90 backdrop-blur md:hidden">
          <div className="flex h-14 items-center justify-between px-4">
            <p className="font-bold text-white">لوحة الإدارة</p>
            <form action={logoutAction}>
              <button className="text-sm font-semibold text-zinc-400">خروج</button>
            </form>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="whitespace-nowrap rounded-full border border-white/10 bg-surface px-3 py-1.5 text-xs font-semibold text-zinc-400"
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-6xl p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
