import { cn } from "@/lib/utils";

/**
 * Official CREATORS ARENA mark — processed from the brand PNG
 * (public/logo.png: cropped, black background made transparent).
 * next/image is intentionally not used: its optimizer needs the native
 * `sharp` binary, which is blocked on this machine.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="CREATORS ARENA"
      className={cn("h-8 w-auto select-none", className)}
      draggable={false}
    />
  );
}

export function LogoWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-bold tracking-wide", className)} dir="ltr">
      <span className="text-white">CREATORS</span>{" "}
      <span className="arena-gradient-text tracking-[0.14em]">ARENA</span>
    </span>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark className="h-7" />
      {!compact && <LogoWordmark className="text-base sm:text-lg" />}
    </span>
  );
}
