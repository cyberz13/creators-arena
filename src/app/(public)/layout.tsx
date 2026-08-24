import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Logo, LogoWordmark } from "@/components/logo";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0B0B0F]/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/">
            <Logo />
          </Link>
          <nav className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/campaigns"
              className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-400 hover:bg-white/10 hover:text-white"
            >
              التحديات
            </Link>
            {user ? (
              <Link href={user.role === "admin" ? "/admin" : "/dashboard"}>
                <Button size="sm">لوحتي</Button>
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  دخول
                </Link>
                <Link href="/register">
                  <Button size="sm">انضم كصانع محتوى</Button>
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-white/10 bg-[#17171C] py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 text-center">
          <LogoWordmark className="text-lg" />
          <p className="text-sm text-zinc-400">
            منصة سعودية تحوّل صناع المحتوى إلى شبكة زيارات حقيقية للمتاجر الإلكترونية.
          </p>
        </div>
      </footer>
    </div>
  );
}
