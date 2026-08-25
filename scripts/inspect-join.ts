import { q } from "../src/lib/db";

async function main() {
  const campaignId = process.argv[2];
  const participants = await q(
    `SELECT cp.username, x.qualified_count, t.code
     FROM campaign_participants x
     JOIN creator_profiles cp ON cp.user_id = x.user_id
     LEFT JOIN tracking_links t ON t.participant_id = x.id
     WHERE x.campaign_id = ?`,
    campaignId
  );
  const users = await q("SELECT email, role FROM users ORDER BY created_at");
  console.log("participants:", JSON.stringify(participants));
  console.log("users:", JSON.stringify(users));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
