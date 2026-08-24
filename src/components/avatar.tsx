import { cn } from "@/lib/utils";

const PALETTE = [
  "bg-brand-500/15 text-brand-300",
  "bg-amber-500/15 text-amber-300",
  "bg-emerald-500/15 text-emerald-300",
  "bg-rose-500/20 text-rose-300",
  "bg-sky-500/20 text-sky-300",
  "bg-violet-500/20 text-violet-300",
];

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const initial = (name || "؟").trim().charAt(0).toUpperCase();
  const colorIdx = [...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % PALETTE.length;
  const sizes = { sm: "size-8 text-sm", md: "size-10 text-base", lg: "size-14 text-xl" };
  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-bold",
        PALETTE[colorIdx],
        sizes[size],
        className
      )}
    >
      {initial}
    </div>
  );
}
