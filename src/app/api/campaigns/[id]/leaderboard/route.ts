import { NextRequest, NextResponse } from "next/server";
import { getLeaderboard, toPublicBoard } from "@/services/leaderboard";
import { getCampaign, ensureLifecycle } from "@/services/campaigns";
import { clientIp } from "@/lib/client-ip";
import { allowRequest } from "@/lib/request-limit";

export const dynamic = "force-dynamic";

/**
 * Public polling endpoint. Returns a minimal DTO (rank, username, display
 * name, avatar, qualified count, winner flag) — never internal ids, e-mails,
 * timestamps or admin fields. Short shared cache + per-IP limiter.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!allowRequest(`api-board:${clientIp(req.headers)}`, 120, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "cache-control": "no-store" } });
  }
  const { id } = await ctx.params;
  if (!/^[a-f0-9-]{36}$/.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const campaign = await getCampaign(id);
  if (!campaign || campaign.status === "draft") return NextResponse.json({ error: "not_found" }, { status: 404 });
  const live = await ensureLifecycle(campaign);
  const board = toPublicBoard(await getLeaderboard(id, 100));
  return NextResponse.json(
    { status: live.status, results_status: live.results_status, board },
    {
      headers: {
        "cache-control": "public, max-age=15, s-maxage=15, stale-while-revalidate=30",
        "x-content-type-options": "nosniff",
      },
    }
  );
}
