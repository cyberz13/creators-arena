"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import {
  adminCancelCampaign,
  adminEndCampaign,
  adminExtendCampaign,
  createCampaign,
  launchCampaign,
  updateDraftCampaign,
  DomainError,
  type CampaignInput,
} from "@/services/campaigns";
import { setUserStatus } from "@/services/creators";
import { updatePayoutStatus } from "@/services/payouts";
import { reviewClick } from "@/services/tracking";
import { setSetting, type SettingKey } from "@/services/settings";
import type { PayoutStatus } from "@/lib/types";

export interface FormState {
  error: string | null;
}

/** Arabic-Indic (٥٠٠) and Persian (۵۰۰) digits → ASCII, so Number() parses them. */
function normalizeDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

function parseCampaignForm(formData: FormData): CampaignInput {
  const prizes = normalizeDigits(String(formData.get("prizes") ?? ""))
    .split(/[,،\s]+/)
    .filter(Boolean)
    .map((p) => Number(p));
  return {
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
    requirements: String(formData.get("requirements") ?? ""),
    store_name: String(formData.get("store_name") ?? ""),
    store_url: String(formData.get("store_url") ?? ""),
    store_logo_url: String(formData.get("store_logo_url") ?? "") || null,
    image_url: String(formData.get("image_url") ?? "") || null,
    start_at: new Date(String(formData.get("start_at") ?? "")).getTime(),
    end_at: new Date(String(formData.get("end_at") ?? "")).getTime(),
    prizes,
  };
}

export async function createCampaignAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const launch = formData.get("intent") === "launch";
  let campaignId: string;
  try {
    const input = parseCampaignForm(formData);
    if (!Number.isFinite(input.start_at) || !Number.isFinite(input.end_at))
      return { error: "حدد تاريخي البداية والنهاية" };
    const campaign = await createCampaign(input, admin.id, launch);
    campaignId = campaign.id;
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath("/admin/campaigns");
  redirect(`/admin/campaigns/${campaignId}`);
}

export async function updateDraftCampaignAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const campaignId = String(formData.get("campaign_id"));
  try {
    const input = parseCampaignForm(formData);
    await updateDraftCampaign(campaignId, input, admin.id);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/admin/campaigns/${campaignId}`);
  redirect(`/admin/campaigns/${campaignId}`);
}

async function guarded(fn: (adminId: string) => Promise<unknown>, paths: string[]) {
  const admin = await requireAdmin();
  try {
    await fn(admin.id);
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  for (const p of paths) revalidatePath(p);
  return { error: null };
}

export async function launchCampaignAction(campaignId: string) {
  return guarded((a) => launchCampaign(campaignId, a), [`/admin/campaigns/${campaignId}`, "/admin/campaigns"]);
}

export async function endCampaignAction(campaignId: string, reason: string) {
  return guarded((a) => adminEndCampaign(campaignId, a, reason), [`/admin/campaigns/${campaignId}`, "/admin/campaigns"]);
}

export async function cancelCampaignAction(campaignId: string, reason: string) {
  return guarded((a) => adminCancelCampaign(campaignId, a, reason), [`/admin/campaigns/${campaignId}`, "/admin/campaigns"]);
}

export async function extendCampaignAction(campaignId: string, newEndAtIso: string, reason: string) {
  const ts = new Date(newEndAtIso).getTime();
  if (!Number.isFinite(ts)) return { error: "تاريخ غير صالح" };
  return guarded((a) => adminExtendCampaign(campaignId, ts, a, reason), [`/admin/campaigns/${campaignId}`, "/admin/campaigns"]);
}

export async function setUserStatusAction(userId: string, status: "active" | "disabled", reason: string) {
  return guarded((a) => setUserStatus(userId, status, a, reason), ["/admin/creators", `/admin/creators/${userId}`]);
}

export async function updatePayoutAction(payoutId: string, status: PayoutStatus, reason: string) {
  return guarded((a) => updatePayoutStatus(payoutId, status, a, reason), ["/admin/payouts"]);
}

export async function reviewClickAction(clickId: string, status: "qualified" | "rejected", reason: string) {
  return guarded((a) => reviewClick(clickId, status, a, reason), ["/admin/clicks"]);
}

export async function updateSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const keys: SettingKey[] = [
    "dedup_window_hours",
    "rate_limit_per_minute",
    "review_threshold_24h",
    "max_devices_per_ip_24h",
    "ip_intel_enabled",
  ];
  for (const key of keys) {
    const value = Number(formData.get(key));
    if (!Number.isFinite(value) || value < 0) return { error: "كل القيم يجب أن تكون أرقامًا موجبة" };
    await setSetting(key, value);
  }
  revalidatePath("/admin/settings");
  return { error: null };
}
