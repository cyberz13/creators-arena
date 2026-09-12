import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { PRODUCT_TZ, riyadhDay, toRiyadhLocalInput } from "./time";

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
    timeZone: PRODUCT_TZ,
  }).format(new Date(ms));
}

export function formatDay(ms: number): string {
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { dateStyle: "medium", timeZone: PRODUCT_TZ }).format(
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

/** Whole days from now until `ms` (never negative) — computed outside React render. */
export function daysUntil(ms: number, nowMs = Date.now()): number {
  return Math.max(0, Math.ceil((ms - nowMs) / 86_400_000));
}

/** True when the campaign ends within 48h — computed outside React render. */
export function isEndingSoon(endAt: number, nowMs = Date.now()): boolean {
  return endAt - nowMs < 48 * 3_600_000;
}

/** Default campaign window for the creation form (now → +7 days), as Riyadh datetime-local strings. */
export function defaultCampaignWindow(nowMs = Date.now()): { start: string; end: string } {
  return { start: toRiyadhLocalInput(nowMs), end: toRiyadhLocalInput(nowMs + 7 * 86_400_000) };
}

/** Day bucket for daily stats — Riyadh calendar day. */
export function dayKey(ms: number): string {
  return riyadhDay(ms);
}
