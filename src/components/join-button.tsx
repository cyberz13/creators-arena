"use client";

import { useState, useTransition } from "react";
import { Rocket } from "lucide-react";
import { Button } from "./ui/button";
import { joinCampaignAction } from "@/app/actions/creator";

export function JoinButton({ campaignId }: { campaignId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function join() {
    startTransition(async () => {
      const res = await joinCampaignAction(campaignId);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <div>
      <Button size="lg" className="w-full sm:w-auto" onClick={join} disabled={pending}>
        <Rocket className="size-5" />
        {pending ? "جارٍ الانضمام..." : "شارك الآن"}
      </Button>
      {error && <p className="mt-2 text-sm font-semibold text-red-400">{error}</p>}
    </div>
  );
}
