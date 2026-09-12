/**
 * Guard for scripts that can reach a real (possibly production) database.
 *
 * Every such script imports this module first. Nothing runs unless the
 * operator explicitly acknowledges:
 *   CONFIRM_PROD_ACCESS=I_UNDERSTAND   (read-only diagnostics)
 *   CONFIRM_PROD_WRITE=I_UNDERSTAND    (additionally, for scripts that write)
 * The connection string comes only from PGURL / DATABASE_URL in the shell —
 * never from a file committed to the repository — and is never printed.
 */
export function requireProdAccess({ write = false } = {}) {
  const url = process.env.PGURL ?? process.env.DATABASE_URL ?? "";
  if (!url) {
    console.error("refusing to run: set PGURL (or DATABASE_URL) in the shell for the target database");
    process.exit(2);
  }
  if (process.env.CONFIRM_PROD_ACCESS !== "I_UNDERSTAND") {
    console.error("refusing to run: this script talks to a live database. Set CONFIRM_PROD_ACCESS=I_UNDERSTAND to proceed.");
    process.exit(2);
  }
  if (write && process.env.CONFIRM_PROD_WRITE !== "I_UNDERSTAND") {
    console.error("refusing to run: this script WRITES to a live database. Set CONFIRM_PROD_WRITE=I_UNDERSTAND to proceed.");
    process.exit(2);
  }
  const host = (() => { try { return new URL(url).host; } catch { return "(unparseable)"; } })();
  console.error(`⚠️  live database target: ${host}${write ? " — WRITE MODE" : " — read-only"}`);
  return url;
}
