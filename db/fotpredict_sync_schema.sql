-- FotPredict public launch sync schema.
-- Apply with: psql "$DATABASE_URL" -f db/fotpredict_sync_schema.sql
-- The Next.js sync store also auto-initializes this schema on first use.

CREATE TABLE IF NOT EXISTS fotpredict_bracket_rooms (
  room_code TEXT PRIMARY KEY,
  owner_pin_hash TEXT NOT NULL,
  group_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_by TEXT NOT NULL DEFAULT 'Commissioner'
);

CREATE INDEX IF NOT EXISTS idx_fotpredict_bracket_rooms_updated_at
  ON fotpredict_bracket_rooms (updated_at DESC);

CREATE TABLE IF NOT EXISTS fotpredict_watchlist_alert_rooms (
  sync_code TEXT PRIMARY KEY,
  tracked_teams JSONB NOT NULL DEFAULT '[]'::jsonb,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  alerts JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_device TEXT NOT NULL DEFAULT 'Browser session',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fotpredict_watchlist_alert_rooms_updated_at
  ON fotpredict_watchlist_alert_rooms (updated_at DESC);
