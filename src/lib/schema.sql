-- منصة تحدي — SQLite schema (portable to PostgreSQL)
-- Timestamps are unix epoch milliseconds (INTEGER).

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'creator' CHECK (role IN ('admin','creator')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id      TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  sort    INTEGER NOT NULL DEFAULT 0,
  active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS creator_profiles (
  user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  username        TEXT NOT NULL UNIQUE,
  avatar_url      TEXT,
  phone           TEXT,
  tiktok          TEXT,
  instagram       TEXT,
  snapchat        TEXT,
  followers_count INTEGER NOT NULL DEFAULT 0,
  category_id     TEXT REFERENCES categories(id),
  created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  requirements   TEXT NOT NULL DEFAULT '',
  store_name     TEXT NOT NULL,
  store_url      TEXT NOT NULL,
  store_logo_url TEXT,
  image_url      TEXT,
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','scheduled','active','ended','cancelled')),
  start_at       INTEGER NOT NULL,
  end_at         INTEGER NOT NULL,
  prize_total    INTEGER NOT NULL DEFAULT 0,
  winners_count  INTEGER NOT NULL DEFAULT 1,
  created_by     TEXT NOT NULL REFERENCES users(id),
  created_at     INTEGER NOT NULL,
  launched_at    INTEGER,
  finalized_at   INTEGER,
  report_token   TEXT
);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_report ON campaigns(report_token);
CREATE INDEX IF NOT EXISTS idx_campaigns_end_at ON campaigns(end_at);

-- Prize snapshot: frozen at launch, one row per rank.
CREATE TABLE IF NOT EXISTS prizes (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  rank        INTEGER NOT NULL,
  amount      INTEGER NOT NULL,
  UNIQUE (campaign_id, rank)
);

CREATE TABLE IF NOT EXISTS campaign_participants (
  id                TEXT PRIMARY KEY,
  campaign_id       TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at         INTEGER NOT NULL,
  total_clicks      INTEGER NOT NULL DEFAULT 0,
  qualified_count   INTEGER NOT NULL DEFAULT 0,
  rejected_count    INTEGER NOT NULL DEFAULT 0,
  pending_count     INTEGER NOT NULL DEFAULT 0,
  last_qualified_at INTEGER,
  final_rank        INTEGER,
  is_winner         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (campaign_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_participants_campaign ON campaign_participants(campaign_id);
CREATE INDEX IF NOT EXISTS idx_participants_user ON campaign_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_participants_board
  ON campaign_participants(campaign_id, qualified_count DESC, last_qualified_at ASC);

CREATE TABLE IF NOT EXISTS tracking_links (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  campaign_id    TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES campaign_participants(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tracking_links_campaign ON tracking_links(campaign_id);
CREATE INDEX IF NOT EXISTS idx_tracking_links_user ON tracking_links(user_id);

CREATE TABLE IF NOT EXISTS clicks (
  id               TEXT PRIMARY KEY,
  tracking_link_id TEXT NOT NULL REFERENCES tracking_links(id) ON DELETE CASCADE,
  campaign_id      TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status           TEXT NOT NULL CHECK (status IN ('qualified','pending_review','rejected')),
  reject_reason    TEXT,
  ip_hash          TEXT NOT NULL,
  session_id       TEXT NOT NULL,
  device_hash      TEXT,
  user_agent       TEXT NOT NULL DEFAULT '',
  referer          TEXT,
  source           TEXT NOT NULL DEFAULT 'direct'
                   CHECK (source IN ('tiktok','instagram','snapchat','direct','other')),
  geo_country      TEXT,
  geo_city         TEXT,
  signals          TEXT,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clicks_campaign ON clicks(campaign_id);
CREATE INDEX IF NOT EXISTS idx_clicks_user ON clicks(user_id);
CREATE INDEX IF NOT EXISTS idx_clicks_link ON clicks(tracking_link_id);
CREATE INDEX IF NOT EXISTS idx_clicks_ip ON clicks(campaign_id, ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_clicks_session ON clicks(campaign_id, session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_clicks_device ON clicks(campaign_id, device_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_clicks_status ON clicks(status);
CREATE INDEX IF NOT EXISTS idx_clicks_created ON clicks(created_at);

-- Cached network intelligence per hashed IP (VPN / datacenter / proxy detection).
CREATE TABLE IF NOT EXISTS ip_intel (
  ip_hash    TEXT PRIMARY KEY,
  risky      INTEGER NOT NULL DEFAULT 0,
  flags      TEXT,
  asn_org    TEXT,
  country    TEXT,
  city       TEXT,
  checked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_daily_stats (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  day         TEXT NOT NULL, -- YYYY-MM-DD (UTC)
  clicks      INTEGER NOT NULL DEFAULT 0,
  qualified   INTEGER NOT NULL DEFAULT 0,
  rejected    INTEGER NOT NULL DEFAULT 0,
  pending     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (campaign_id, day)
);
CREATE INDEX IF NOT EXISTS idx_daily_stats_campaign ON campaign_daily_stats(campaign_id, day);

CREATE TABLE IF NOT EXISTS payouts (
  id          TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prize_rank  INTEGER NOT NULL,
  amount      INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','approved','paid','rejected')),
  updated_by  TEXT REFERENCES users(id),
  updated_at  INTEGER,
  created_at  INTEGER NOT NULL,
  UNIQUE (campaign_id, prize_rank)
);
CREATE INDEX IF NOT EXISTS idx_payouts_user ON payouts(user_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE,
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at);

CREATE TABLE IF NOT EXISTS admin_actions (
  id          TEXT PRIMARY KEY,
  admin_id    TEXT NOT NULL REFERENCES users(id),
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_actions_created ON admin_actions(created_at);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
