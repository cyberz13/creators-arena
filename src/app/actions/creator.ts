"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCreator } from "@/lib/auth";
import { joinCampaign, DomainError } from "@/services/campaigns";
import { markAllRead } from "@/services/notifications";

export async function joinCampaignAction(campaignId: string): Promise<{ error: string | null }> {
  const user = await requireCreator();
  try {
    await joinCampaign(campaignId, user.id);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/campaigns/${campaignId}`);
  redirect(`/campaigns/${campaignId}`);
}

export async function markNotificationsReadAction() {
  const user = await requireCreator();
  await markAllRead(user.id);
  revalidatePath("/dashboard/notifications");
}
