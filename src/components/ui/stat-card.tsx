import { Card } from "./card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  icon,
  accent = "brand",
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  accent?: "brand" | "gold" | "green" | "red" | "slate";
}) {
  const accents = {
    brand: "bg-brand-500/10 text-brand-400",
    gold: "bg-amber-500/10 text-amber-400",
    green: "bg-emerald-500/10 text-emerald-400",
    red: "bg-red-500/10 text-red-400",
    slate: "bg-white/10 text-zinc-400",
  } as const;
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-zinc-400">{label}</p>
          <p className="tabular mt-1 truncate text-2xl font-bold text-white">{value}</p>
          {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
        </div>
        {icon && (
          <div className={cn("grid size-10 shrink-0 place-items-center rounded-xl", accents[accent])}>
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}
