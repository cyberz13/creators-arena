/**
 * Verifies the serialized PG driver against the real database:
 * fires the exact parallel burst that used to hang the pooler.
 *   DATABASE_URL="postgresql://..." npx tsx scripts/verify-driver-queue.ts
 */
import { adminOverview, dailyVisits, trafficSources, topCreators } from "../src/services/analytics";
// Live-database guard (see scripts/lib/prod-guard.mjs): explicit acknowledgement required.
if (!process.env.DATABASE_URL) { console.error("refusing to run: set DATABASE_URL in the shell for the target database"); process.exit(2); }
if (process.env.CONFIRM_PROD_ACCESS !== "I_UNDERSTAND") { console.error("refusing to run: this script talks to a live database. Set CONFIRM_PROD_ACCESS=I_UNDERSTAND to proceed."); process.exit(2); }


async function main() {
  const t0 = Date.now();
  const [overview, daily, sources, top] = await Promise.all([
    adminOverview(),
    dailyVisits(undefined, 30),
    trafficSources(),
    topCreators(5),
  ]);
  console.log(`✅ parallel burst OK in ${Date.now() - t0}ms`);
  console.log(
    `creators=${overview.creators} qualified=${overview.qualifiedVisits} days=${daily.length} sources=${sources.length} top=${top.length}`
  );
  process.exit(0);
}
main();
