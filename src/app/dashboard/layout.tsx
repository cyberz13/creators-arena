import Link from "next/link";
import { Bell, Home, Megaphone, User } from "lucide-react";
import { Logo } from "@/components/logo";
import { requireCreator } from "@/lib/auth";
import { unreadCount } from "@/services/notifications";
import { logoutAction } from "@/app/actions/auth";

const NAV = [
  { href: "/dashboard", label: "الرئيسية", icon: Home },
  { href: "/dashboard/campaigns", label: "حملاتي", icon: Megaphone },
  { href: "/dashboard/notifications", label: "الإشعارات", icon: Bell },
  { href: "/dashboard/profile", label: "ملفي", icon: User },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireCreator();
  const unread = await unreadCount(user.id);

  return (
    <div className="min-h-dvh pb-20 md:pb-0">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
          <Link href="/dashboard">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="relative rounded-lg px-3 py-2 text-sm font-semibold text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                {n.label}
                {n.href === "/dashboard/notifications" && unread > 0 && (
                  <span className="absolute -top-0.5 left-0 grid size-4 place-items-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/campaigns" className="hidden text-sm font-semibold text-brand-400 hover:text-brand-300 sm:block">
              تصفح التحديات
            </Link>
            <form action={logoutAction}>
              <button className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-400 hover:bg-white/10">
                خروج
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-canvas/95 backdrop-blur md:hidden">
        <div className="grid grid-cols-4">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="relative flex flex-col items-center gap-0.5 py-2.5 text-zinc-400 hover:text-brand-400"
            >
              <n.icon className="size-5" />
              <span className="text-[11px] font-semibold">{n.label}</span>
              {n.href === "/dashboard/notifications" && unread > 0 && (
                <span className="absolute right-[calc(50%-18px)] top-1 grid size-4 place-items-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
