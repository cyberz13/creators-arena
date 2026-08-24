import { Badge } from "./ui/badge";
import type { CampaignStatus } from "@/lib/types";

const MAP: Record<CampaignStatus, { label: string; variant: "default" | "brand" | "success" | "warning" | "danger" }> = {
  draft: { label: "مسودة", variant: "default" },
  scheduled: { label: "مجدولة", variant: "warning" },
  active: { label: "نشطة", variant: "success" },
  ended: { label: "منتهية", variant: "brand" },
  cancelled: { label: "ملغاة", variant: "danger" },
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const m = MAP[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export const PAYOUT_LABELS: Record<string, { label: string; variant: "default" | "brand" | "success" | "warning" | "danger" }> = {
  pending: { label: "بانتظار الاعتماد", variant: "warning" },
  approved: { label: "معتمدة", variant: "brand" },
  paid: { label: "مدفوعة", variant: "success" },
  rejected: { label: "مرفوضة", variant: "danger" },
};
