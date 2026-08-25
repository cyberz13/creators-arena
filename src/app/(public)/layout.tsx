import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { Logo, LogoMark, LogoWordmark } from "@/components/logo";

const NAV = [
  { href: "/", label: "الرئيسية" },
  { href: "/campaigns", label: "التحديات" },
  { href: "/leaderboard", label: "المتصدرون" },
];

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-hidden">
      {/* ambient glows (Nocturne) */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute -top-[16%] -right-[8%] h-[760px] w-[760px] rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,#9184d9_24%,transparent),transparent_62%)] blur-[32px] [animation:glowA_22s_ease-in-out_infinite]" />
        <div className="absolute top-[26%] -left-[14%] h-[620px] w-[620px] rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,#423a6a_70%,transparent),transparent_66%)] blur-[42px] [animation:glowB_28s_ease-in-out_infinite]" />
      </div>

      <header className="sticky top-0 z-30 bg-canvas/85 shadow-[0_1px_0_0_var(--divider)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1160px] items-center gap-4 px-5 py-3 sm:gap-7 sm:px-6">
          <Link href="/" className="shrink-0">
            <Logo />
          </Link>
          <nav className="ms-auto flex items-center gap-3 text-sm sm:gap-6">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="hidden text-zinc-400 transition-colors hover:text-brand-500 sm:block"
              >
                {n.label}
              </Link>
            ))}
            {user ? (
              <Link
                href={user.role === "admin" ? "/admin" : "/dashboard"}
                className="rounded-lg border border-brand-500 px-4 py-2 text-[13px] font-medium text-brand-500 transition-colors hover:bg-brand-500/10"
              >
                لوحتي
              </Link>
            ) : (
              <Link
                href="/register"
                className="rounded-lg border border-brand-500 px-4 py-2 text-[13px] font-medium text-brand-500 transition-colors hover:bg-brand-500/10"
              >
                انضم كصانع محتوى
              </Link>
            )}
          </nav>
        </div>
      </header>

      <main className="relative z-10 flex-1">{children}</main>

      <footer className="relative z-10 bg-[color-mix(in_srgb,#232532_45%,transparent)] shadow-[0_-1px_0_0_var(--divider)]">
        <div className="mx-auto grid max-w-[1160px] grid-cols-2 gap-8 px-6 py-13 sm:py-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2.5">
              <LogoMark className="h-[30px]" />
              <LogoWordmark className="text-[15px]" />
            </div>
            <p className="mt-4 max-w-[32ch] text-[13px] leading-7 text-zinc-500">
              ساحة تنافس صنّاع المحتوى مع المتاجر الإلكترونية — زيارات حقيقية، ترتيب شفاف،
              جوائز معلنة.
            </p>
          </div>
          <div className="flex flex-col gap-2.5 text-[13px]">
            <span className="font-semibold text-zinc-300">المنصة</span>
            <Link href="/campaigns" className="text-zinc-500 hover:text-brand-500">التحديات</Link>
            <Link href="/leaderboard" className="text-zinc-500 hover:text-brand-500">المتصدرون</Link>
            <Link href="/register" className="text-zinc-500 hover:text-brand-500">انضم</Link>
          </div>
          <div className="flex flex-col gap-2.5 text-[13px]">
            <span className="font-semibold text-zinc-300">للصنّاع</span>
            <Link href="/login" className="text-zinc-500 hover:text-brand-500">تسجيل الدخول</Link>
            <Link href="/dashboard" className="text-zinc-500 hover:text-brand-500">لوحتي</Link>
            <Link href="/#faq" className="text-zinc-500 hover:text-brand-500">كيف نحسب الزيارات</Link>
          </div>
          <div className="flex flex-col gap-2.5 text-[13px]">
            <span className="font-semibold text-zinc-300">قانوني</span>
            <span className="text-zinc-500">الشروط والأحكام</span>
            <span className="text-zinc-500">سياسة الخصوصية</span>
          </div>
        </div>
        <div className="mx-auto max-w-[1160px] px-6 pb-8 pt-1 text-xs text-zinc-600">
          © ٢٠٢٦ Creators Arena. جميع الحقوق محفوظة.
        </div>
      </footer>
    </div>
  );
}
