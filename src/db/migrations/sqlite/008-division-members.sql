CREATE TABLE IF NOT EXISTS division_members (
  id          TEXT NOT NULL PRIMARY KEY,
  division_id TEXT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK(role IN ('lead', 'member', 'operative')),
  assigned_at TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  UNIQUE(division_id, agent_id)
);
