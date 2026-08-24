import { NextRequest, NextResponse } from "next/server";
import { getLeaderboard } from "@/services/leaderboard";
import { getCampaign, ensureLifecycle } from "@/services/campaigns";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const campaign = await getCampaign(id);
  if (!campaign) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const live = await ensureLifecycle(campaign);
  return NextResponse.json({
    status: live.status,
    board: await getLeaderboard(id, 100),
  });
}
