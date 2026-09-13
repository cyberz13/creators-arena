"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, verifyPassword } from "@/lib/auth";
import { one } from "@/lib/db";
import {
  adminCancelCampaign,
  adminEndCampaign,
  adminExtendCampaign,
  createCampaign,
  launchCampaign,
  updateDraftCampaign,
  updateCampaignDetails,
  DomainError,
  type CampaignInput,
} from "@/services/campaigns";
import { approveCreator, setParticipationStatus, setUserStatus } from "@/services/creators";
import { updatePayoutStatus } from "@/services/payouts";
import { reviewClick } from "@/services/tracking";
import { confirmResults, correctResults, excludeParticipant } from "@/services/results";
import { setSetting, type SettingKey } from "@/services/settings";
import { revokeReportToken, rotateReportToken } from "@/services/store-report";
import type { PayoutStatus, User } from "@/lib/types";
import { parseRiyadhLocalInput } from "@/lib/time";

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
    // datetime-local values are Riyadh wall-clock time with an explicit +03:00 offset
    start_at: parseRiyadhLocalInput(String(formData.get("start_at") ?? "")),
    end_at: parseRiyadhLocalInput(String(formData.get("end_at") ?? "")),
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

export async function updateCampaignDetailsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const campaignId = String(formData.get("campaign_id"));
  try {
    await updateCampaignDetails(
      campaignId,
      {
        title: String(formData.get("title") ?? ""),
        description: String(formData.get("description") ?? ""),
        requirements: String(formData.get("requirements") ?? ""),
        store_name: String(formData.get("store_name") ?? ""),
        store_url: String(formData.get("store_url") ?? ""),
        store_logo_url: String(formData.get("store_logo_url") ?? "") || null,
        image_url: String(formData.get("image_url") ?? "") || null,
      },
      admin.id
    );
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/admin/campaigns/${campaignId}`);
  revalidatePath("/admin/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);
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

const campaignPaths = (id: string) => [`/admin/campaigns/${id}`, "/admin/campaigns", `/campaigns/${id}`, "/admin/payouts"];

export async function launchCampaignAction(campaignId: string) {
  return guarded((a) => launchCampaign(campaignId, a), campaignPaths(campaignId));
}

export async function endCampaignAction(campaignId: string, reason: string) {
  return guarded((a) => adminEndCampaign(campaignId, a, reason), campaignPaths(campaignId));
}

export async function cancelCampaignAction(campaignId: string, reason: string) {
  return guarded((a) => adminCancelCampaign(campaignId, a, reason), campaignPaths(campaignId));
}

export async function extendCampaignAction(campaignId: string, newEndAtIso: string, reason: string) {
  const ts = parseRiyadhLocalInput(newEndAtIso.trim());
  if (!Number.isFinite(ts)) return { error: "تاريخ غير صالح (الصيغة: 2026-09-01T20:00 بتوقيت الرياض)" };
  return guarded((a) => adminExtendCampaign(campaignId, ts, a, reason), campaignPaths(campaignId));
}

export async function confirmResultsAction(campaignId: string) {
  return guarded((a) => confirmResults(campaignId, a), campaignPaths(campaignId));
}

export async function correctResultsAction(campaignId: string, reason: string) {
  return guarded((a) => correctResults(campaignId, a, reason), campaignPaths(campaignId));
}

export async function excludeParticipantAction(campaignId: string, userId: string, excluded: boolean, reason: string) {
  return guarded((a) => excludeParticipant(campaignId, userId, a, reason, excluded), [
    ...campaignPaths(campaignId),
    `/admin/creators/${userId}`,
  ]);
}

export async function rotateReportTokenAction(campaignId: string) {
  return guarded((a) => rotateReportToken(campaignId, a), [`/admin/campaigns/${campaignId}`]);
}

export async function revokeReportTokenAction(campaignId: string, reason: string) {
  return guarded(async (a) => {
    await revokeReportToken(campaignId, a);
    void reason;
  }, [`/admin/campaigns/${campaignId}`]);
}

export async function setUserStatusAction(userId: string, status: "active" | "disabled", reason: string) {
  return guarded((a) => setUserStatus(userId, status, a, reason), ["/admin/creators", `/admin/creators/${userId}`]);
}

export async function setParticipationStatusAction(userId: string, status: "active" | "suspended", reason: string) {
  return guarded((a) => setParticipationStatus(userId, status, a, reason), ["/admin/creators", `/admin/creators/${userId}`]);
}

export async function approveCreatorAction(userId: string) {
  return guarded((a) => approveCreator(userId, a), ["/admin/creators", `/admin/creators/${userId}`]);
}

/**
 * Payout transitions. Marking a prize as PAID is irreversible money movement,
 * so it requires the admin to re-enter their password in the same request.
 */
export async function updatePayoutAction(payoutId: string, status: PayoutStatus, reason: string, password?: string) {
  const admin = await requireAdmin();
  let reauthenticated = false;
  if (status === "paid") {
    const row = await one<User>("SELECT * FROM users WHERE id = ?", admin.id);
    if (!row || !password || !(await verifyPassword(password, row.password_hash))) {
      return { error: "كلمة المرور غير صحيحة — لم يتم تأكيد الدفع" };
    }
    reauthenticated = true;
  }
  return guarded((a) => updatePayoutStatus(payoutId, status, a, reason, { reauthenticated }), ["/admin/payouts"]);
}

export async function reviewClickAction(
  clickId: string,
  status: "qualified" | "rejected",
  reason: string,
  correction = false
) {
  return guarded((a) => reviewClick(clickId, status, a, reason, { correction }), ["/admin/clicks", "/admin/campaigns"]);
}

export async function updateSettingsAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const keys: SettingKey[] = [
    "dedup_window_hours",
    "rate_limit_per_minute",
    "review_threshold_24h",
    "max_devices_per_ip_24h",
    "ip_intel_enabled",
    "ip_unverified_action",
  ];
  for (const key of keys) {
    const value = Number(formData.get(key));
    if (!Number.isFinite(value) || value < 0) return { error: "كل القيم يجب أن تكون أرقامًا موجبة" };
    await setSetting(key, value);
  }
  revalidatePath("/admin/settings");
  return { error: null };
}
