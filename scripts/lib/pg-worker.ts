/**
 * Worker for scripts/pg-concurrency-test.mjs. Runs ONE scenario step in its
 * own OS process (own PostgreSQL connection), exactly like a separate
 * serverless instance would. Prints a JSON result line on stdout.
 *
 *   DATABASE_URL=<test db> npx tsx scripts/lib/pg-worker.ts <scenario> <json-args>
 */
import { finalizeCampaign } from "../../src/services/campaigns";
import { recordClick, reviewClick } from "../../src/services/tracking";
import { updatePayoutStatus } from "../../src/services/payouts";
import { confirmResults } from "../../src/services/results";
import { DomainError } from "../../src/services/errors";

const [scenario, rawArgs] = process.argv.slice(2);
const args = JSON.parse(rawArgs ?? "{}") as Record<string, string | number>;

async function main(): Promise<unknown> {
  switch (scenario) {
    case "finalize":
      return { claimed: await finalizeCampaign(String(args.campaignId)) };
    case "confirm":
      try {
        await confirmResults(String(args.campaignId), String(args.adminId));
        return { ok: true };
      } catch (e) {
        if (e instanceof DomainError) return { ok: false, domain: e.message };
        throw e;
      }
    case "review":
      try {
        await reviewClick(String(args.clickId), "qualified", String(args.adminId), "concurrency");
        return { ok: true };
      } catch (e) {
        if (e instanceof DomainError) return { ok: false, domain: e.message };
        throw e;
      }
    case "payout":
      try {
        await updatePayoutStatus(String(args.payoutId), args.status as "approved" | "paid", String(args.adminId), "", {
          reauthenticated: true,
        });
        return { ok: true };
      } catch (e) {
        if (e instanceof DomainError) return { ok: false, domain: e.message };
        throw e;
      }
    case "clicks": {
      const n = Number(args.count ?? 5);
      const results: string[] = [];
      for (let i = 0; i < n; i++) {
        const r = await recordClick({
          code: String(args.code),
          ipHash: String(args.ipHash),
          sessionId: `${args.worker}-s${i}`,
          deviceHash: `${args.worker}-d${i}`,
          userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1",
          referer: null,
          utmSource: null,
        });
        results.push(String(r.status));
      }
      return { statuses: results };
    }
    default:
      throw new Error("unknown scenario " + scenario);
  }
}

main()
  .then((r) => {
    process.stdout.write(JSON.stringify(r) + "\n");
    process.exit(0);
  })
  .catch((e) => {
    process.stdout.write(JSON.stringify({ error: String(e?.message ?? e) }) + "\n");
    process.exit(1);
  });
