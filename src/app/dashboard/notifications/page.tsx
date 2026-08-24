import { requireCreator } from "@/lib/auth";
import { listNotifications } from "@/services/notifications";
import { markNotificationsReadAction } from "@/app/actions/creator";
import { Card } from "@/components/ui/card";
import { formatDate, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "الإشعارات" };

const TYPE_ICONS: Record<string, string> = {
  campaign_joined: "🎯",
  rank_first: "👑",
  rank_overtaken: "⚠️",
  campaign_ending_soon: "⏰",
  campaign_ended: "🏁",
  campaign_won: "🏆",
  prize_approved: "✅",
  prize_paid: "💰",
};

export default async function NotificationsPage() {
  const user = await requireCreator();
  const notifications = await listNotifications(user.id, 50);
  const hasUnread = notifications.some((n) => n.read === 0);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">الإشعارات</h1>
        {hasUnread && (
          <form action={markNotificationsReadAction}>
            <button className="text-sm font-bold text-brand-400 hover:text-brand-300">
              تحديد الكل كمقروء
            </button>
          </form>
        )}
      </div>

      {notifications.length === 0 ? (
        <Card className="p-10 text-center text-zinc-400">
          <p className="text-4xl">🔔</p>
          <p className="mt-3">لا إشعارات بعد — شارك في تحدٍّ وستصلك التحديثات هنا.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => (
            <Card
              key={n.id}
              className={cn("flex gap-3 p-4", n.read === 0 && "border-brand-500/30 bg-brand-500/10")}
            >
              <span className="text-2xl">{TYPE_ICONS[n.type] ?? "🔔"}</span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-white">{n.title}</p>
                {n.body && <p className="mt-0.5 text-sm text-zinc-400">{n.body}</p>}
                <p className="mt-1 text-xs text-zinc-500">{formatDate(n.created_at)}</p>
              </div>
              {n.read === 0 && <span className="mt-1 size-2 shrink-0 rounded-full bg-brand-500" />}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
