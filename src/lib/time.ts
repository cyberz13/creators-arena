/**
 * Product time zone. Saudi Arabia has no daylight saving, so a fixed +03:00
 * offset is exact; Intl is still used for display so month/day names and
 * numbering stay locale-correct.
 */
export const PRODUCT_TZ = "Asia/Riyadh";
export const PRODUCT_OFFSET_MS = 3 * 3_600_000;

/** `YYYY-MM-DD` of the given instant in Riyadh time (day boundaries for stats). */
export function riyadhDay(ms: number): string {
  return new Date(ms + PRODUCT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Hour of day (0-23) in Riyadh time. */
export function riyadhHour(ms: number): number {
  return new Date(ms + PRODUCT_OFFSET_MS).getUTCHours();
}

/** `YYYY-MM-DDTHH:mm` for datetime-local inputs, expressed in Riyadh time. */
export function toRiyadhLocalInput(ms: number): string {
  return new Date(ms + PRODUCT_OFFSET_MS).toISOString().slice(0, 16);
}

/**
 * Parses a datetime-local value entered by an admin as Riyadh wall-clock time
 * with an EXPLICIT offset — never the server's (or the browser's) time zone.
 * Returns NaN for malformed input.
 */
export function parseRiyadhLocalInput(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return NaN;
  return Date.parse(`${value.length === 16 ? value + ":00" : value}+03:00`);
}
