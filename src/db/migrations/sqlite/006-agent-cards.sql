CREATE TABLE IF NOT EXISTS agent_cards (
  id TEXT PRIMARY KEY,
  callsign TEXT NOT NULL,
  name TEXT NOT NULL,
  operator TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  primary_skills TEXT NOT NULL DEFAULT '[]',
  runtime TEXT NOT NULL,
  model TEXT,
  endpoint_url TEXT,
  description TEXT NOT NULL DEFAULT '',
  approval_status TEXT NOT NULL DEFAULT 'pending',
  approved_by TEXT,
  approved_at TEXT,
  rejection_reason TEXT,
  agent_id TEXT,
  submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_cards_status ON agent_cards(approval_status);
CREATE INDEX IF NOT EXISTS idx_agent_cards_callsign ON agent_cards(callsign);
