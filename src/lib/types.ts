export type Role = "admin" | "creator";
export type UserStatus = "active" | "disabled";
export type CampaignStatus = "draft" | "scheduled" | "active" | "ended" | "cancelled";
export type ClickStatus = "qualified" | "pending_review" | "rejected";
export type PayoutStatus = "pending" | "approved" | "paid" | "rejected";
export type TrafficSource = "tiktok" | "instagram" | "snapchat" | "direct" | "other";

export interface User {
  id: string;
  email: string;
  password_hash: string;
  role: Role;
  status: UserStatus;
  created_at: number;
}

export interface CreatorProfile {
  user_id: string;
  name: string;
  username: string;
  avatar_url: string | null;
  phone: string | null;
  tiktok: string | null;
  instagram: string | null;
  snapchat: string | null;
  followers_count: number;
  category_id: string | null;
  created_at: number;
}

export interface Category {
  id: string;
  name_ar: string;
  name_en: string;
  sort: number;
  active: number;
}

export interface Campaign {
  id: string;
  title: string;
  description: string;
  requirements: string;
  store_name: string;
  store_url: string;
  store_logo_url: string | null;
  image_url: string | null;
  status: CampaignStatus;
  start_at: number;
  end_at: number;
  prize_total: number;
  winners_count: number;
  created_by: string;
  created_at: number;
  launched_at: number | null;
  finalized_at: number | null;
}

export interface Prize {
  id: string;
  campaign_id: string;
  rank: number;
  amount: number;
}

export interface Participant {
  id: string;
  campaign_id: string;
  user_id: string;
  joined_at: number;
  total_clicks: number;
  qualified_count: number;
  rejected_count: number;
  pending_count: number;
  last_qualified_at: number | null;
  final_rank: number | null;
  is_winner: number;
}

export interface TrackingLink {
  id: string;
  code: string;
  campaign_id: string;
  participant_id: string;
  user_id: string;
  created_at: number;
}

export interface Click {
  id: string;
  tracking_link_id: string;
  campaign_id: string;
  user_id: string;
  status: ClickStatus;
  reject_reason: string | null;
  ip_hash: string;
  session_id: string;
  user_agent: string;
  referer: string | null;
  source: TrafficSource;
  created_at: number;
}

export interface Payout {
  id: string;
  campaign_id: string;
  user_id: string;
  prize_rank: number;
  amount: number;
  status: PayoutStatus;
  updated_by: string | null;
  updated_at: number | null;
  created_at: number;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  campaign_id: string | null;
  read: number;
  created_at: number;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  username: string;
  name: string;
  avatar_url: string | null;
  qualified_count: number;
  last_qualified_at: number | null;
  is_winner?: boolean;
}
