-- VALOR Engine: Initial Schema
-- Phase 0 Foundation

CREATE TABLE IF NOT EXISTS divisions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lead_agent_id TEXT,
  autonomy_policy TEXT NOT NULL DEFAULT '{}',
  escalation_policy TEXT NOT NULL DEFAULT '{}',
  namespace TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  callsign TEXT NOT NULL,
  division_id TEXT,
  runtime TEXT NOT NULL,
  endpoint_url TEXT,
  model TEXT,
  health_status TEXT NOT NULL DEFAULT 'registered',
  last_heartbeat TEXT,
  persona_id TEXT,
  capabilities TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (division_id) REFERENCES divisions(id)
);

CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  division_id TEXT,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  phase TEXT,
  assigned_agent_id TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  constraints TEXT NOT NULL DEFAULT '[]',
  deliverables TEXT NOT NULL DEFAULT '[]',
  success_criteria TEXT NOT NULL DEFAULT '[]',
  token_usage TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  revision_count INTEGER NOT NULL DEFAULT 0,
  max_revisions INTEGER NOT NULL DEFAULT 3,
  parent_mission_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dispatched_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (division_id) REFERENCES divisions(id),
  FOREIGN KEY (assigned_agent_id) REFERENCES agents(id),
  FOREIGN KEY (parent_mission_id) REFERENCES missions(id)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '{}',
  target TEXT,
  conversation_id TEXT,
  in_reply_to TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  metadata TEXT
);

CREATE TABLE IF NOT EXISTS sitreps (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT NOT NULL,
  objectives_complete TEXT NOT NULL DEFAULT '[]',
  objectives_pending TEXT NOT NULL DEFAULT '[]',
  blockers TEXT NOT NULL DEFAULT '[]',
  learnings TEXT NOT NULL DEFAULT '[]',
  confidence TEXT NOT NULL DEFAULT 'medium',
  tokens_used INTEGER NOT NULL DEFAULT 0,
  delivered_to TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY (mission_id) REFERENCES missions(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE TABLE IF NOT EXISTS gate_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id TEXT NOT NULL,
  gate TEXT NOT NULL,
  verdict TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (mission_id) REFERENCES missions(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  before_state TEXT,
  after_state TEXT,
  actor_id TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_missions_division_status ON missions(division_id, status);
CREATE INDEX IF NOT EXISTS idx_agents_division_status ON agents(division_id, health_status);
CREATE INDEX IF NOT EXISTS idx_events_type_timestamp ON events(type, timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_sitreps_mission ON sitreps(mission_id);
CREATE INDEX IF NOT EXISTS idx_gate_results_mission ON gate_results(mission_id);
