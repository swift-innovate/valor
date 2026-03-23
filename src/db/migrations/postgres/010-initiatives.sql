CREATE TABLE IF NOT EXISTS initiatives (
  id          TEXT NOT NULL PRIMARY KEY,
  title       TEXT NOT NULL,
  objective   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active'
                CHECK(status IN ('active', 'paused', 'complete', 'cancelled')),
  owner       TEXT,
  priority    TEXT NOT NULL DEFAULT 'normal'
                CHECK(priority IN ('critical', 'high', 'normal', 'low')),
  target_date TEXT,
  created_at  TEXT NOT NULL DEFAULT (NOW()::TEXT),
  updated_at  TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

ALTER TABLE missions ADD COLUMN IF NOT EXISTS initiative_id TEXT REFERENCES initiatives(id);

CREATE INDEX IF NOT EXISTS idx_missions_initiative ON missions(initiative_id);
