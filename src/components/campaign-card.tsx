import Link from "next/link";
import { Store, Users, Eye, Trophy, Timer } from "lucide-react";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { formatNumber, formatRemaining, formatSAR } from "@/lib/utils";
import type { CampaignWithStats } from "@/services/campaigns";

export function CampaignCard({ campaign }: { campaign: CampaignWithStats }) {
  return (
    <Link href={`/campaigns/${campaign.id}`} className="group block">
      <Card className="overflow-hidden transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-lg group-hover:shadow-brand-600/10">
        <div className="relative flex h-24 items-end bg-gradient-to-l from-brand-700 via-brand-600 to-brand-500 p-4">
          <div className="absolute inset-0 opacity-15 [background-image:radial-gradient(circle_at_80%_20%,white_0,transparent_45%)]" />
          <div className="relative flex items-center gap-2 text-white">
            <div className="grid size-9 place-items-center rounded-xl bg-white/15 backdrop-blur">
              <Store className="size-4" />
            </div>
            <div>
              <p className="text-xs text-brand-100">{campaign.store_name}</p>
              <p className="font-bold leading-tight">{campaign.title}</p>
            </div>
          </div>
          <Badge variant="gold" className="absolute left-3 top-3 shadow-sm">
            <Trophy className="size-3" />
            {formatSAR(campaign.prize_total)}
          </Badge>
        </div>
        <div className="grid grid-cols-3 divide-x divide-x-reverse divide-white/5 border-b border-white/[0.06] text-center">
          <div className="py-3">
            <p className="tabular text-sm font-bold text-white">
              {formatNumber(campaign.participants_count)}
            </p>
            <p className="flex items-center justify-center gap-1 text-[11px] text-zinc-500">
              <Users className="size-3" /> مشارك
            </p>
          </div>
          <div className="py-3">
            <p className="tabular text-sm font-bold text-white">
              {formatNumber(campaign.qualified_total)}
            </p>
            <p className="flex items-center justify-center gap-1 text-[11px] text-zinc-500">
              <Eye className="size-3" /> زيارة
            </p>
          </div>
          <div className="py-3">
            <p className="text-sm font-bold text-white">
              {formatRemaining(campaign.end_at)}
            </p>
            <p className="flex items-center justify-center gap-1 text-[11px] text-zinc-500">
              <Timer className="size-3" /> متبقي
            </p>
          </div>
        </div>
        <div className="p-3">
          <span className="block w-full rounded-xl bg-brand-600 py-2.5 text-center text-sm font-bold text-white transition-colors group-hover:bg-brand-700">
            شارك الآن 🚀
          </span>
        </div>
      </Card>
    </Link>
  );
}
