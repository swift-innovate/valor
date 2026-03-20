-- VALOR Engine: Approval Queue (Postgres dialect)
-- Phase 2 Mission Lifecycle

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  gate TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_by TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  expires_at TEXT,
  FOREIGN KEY (mission_id) REFERENCES missions(id)
);

CREATE INDEX IF NOT EXISTS idx_approvals_mission ON approvals(mission_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
