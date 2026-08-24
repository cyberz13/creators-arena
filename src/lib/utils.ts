import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const nf = new Intl.NumberFormat("ar-SA-u-nu-latn");

export function formatNumber(n: number): string {
  return nf.format(n);
}

export function formatSAR(n: number): string {
  return `${nf.format(n)} ريال`;
}

export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ms));
}

export function formatDay(ms: number): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { dateStyle: "medium" }).format(
    new Date(ms)
  );
}

/** "2 يوم 14 ساعة" style remaining-time label. */
export function formatRemaining(untilMs: number, fromMs = Date.now()): string {
  let diff = Math.max(0, untilMs - fromMs);
  const days = Math.floor(diff / 86_400_000);
  diff -= days * 86_400_000;
  const hours = Math.floor(diff / 3_600_000);
  diff -= hours * 3_600_000;
  const minutes = Math.floor(diff / 60_000);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} يوم`);
  if (hours > 0) parts.push(`${hours} ساعة`);
  if (days === 0 && minutes > 0) parts.push(`${minutes} دقيقة`);
  if (parts.length === 0) parts.push("أقل من دقيقة");
  return parts.join(" و");
}

export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
