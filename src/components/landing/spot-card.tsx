"use client";

import { cn } from "@/lib/utils";

/** Nocturne spotlight-hover wrapper: children render above a cursor-tracked glow. */
export function SpotCard({
  className,
  children,
  as: Tag = "div",
}: {
  className?: string;
  children: React.ReactNode;
  as?: "div" | "section";
}) {
  return (
    <Tag
      className={cn("relative overflow-hidden", className)}
      onMouseMove={(e) => {
        const el = e.currentTarget as HTMLElement;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - r.left}px`);
        el.style.setProperty("--my", `${e.clientY - r.top}px`);
        el.style.setProperty("--sp", "1");
      }}
      onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.setProperty("--sp", "0")}
    >
      <div className="spot-layer" />
      {children}
    </Tag>
  );
}
