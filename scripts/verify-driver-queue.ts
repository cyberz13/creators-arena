/**
 * Verifies the serialized PG driver against the real database:
 * fires the exact parallel burst that used to hang the pooler.
 *   DATABASE_URL="postgresql://..." npx tsx scripts/verify-driver-queue.ts
 */
import { adminOverview, dailyVisits, trafficSources, topCreators } from "../src/services/analytics";

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
