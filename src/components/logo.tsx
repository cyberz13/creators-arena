import { cn } from "@/lib/utils";

/**
 * Official CREATORS ARENA mark (public/logo.png: transparent, from the brand PNG).
 * Wordmark styling follows the Nocturne design: 0.08em tracking, ARENA in accent.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="CREATORS ARENA"
      className={cn("h-8 w-auto select-none lighten", className)}
      draggable={false}
    />
  );
}

export function LogoWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-semibold tracking-[0.08em]", className)} dir="ltr">
      <span className="text-[#e9e9ed]">CREATORS</span>{" "}
      <span className="text-brand-500">ARENA</span>
    </span>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark className="h-[34px]" />
      {!compact && <LogoWordmark className="text-base" />}
    </span>
  );
}
