-- VECTOR decision engine persistence
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  mission_id TEXT REFERENCES missions(id),
  title TEXT NOT NULL,
  context TEXT NOT NULL,
  constraints TEXT NOT NULL,       -- JSON array
  time_horizon TEXT NOT NULL,
  stakes TEXT NOT NULL CHECK(stakes IN ('low', 'medium', 'high')),
  confidence_level INTEGER NOT NULL CHECK(confidence_level BETWEEN 1 AND 10),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vector_analyses (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES decisions(id),
  visualize TEXT NOT NULL,         -- JSON
  evaluate TEXT NOT NULL,          -- JSON
  choose TEXT NOT NULL,            -- JSON
  test TEXT NOT NULL,              -- JSON
  optimize TEXT NOT NULL,          -- JSON
  review TEXT NOT NULL,            -- JSON
  bias_risk TEXT NOT NULL,         -- JSON
  model_used TEXT NOT NULL,
  total_risk_score REAL NOT NULL,
  recommendation TEXT NOT NULL CHECK(recommendation IN ('proceed', 'proceed_with_caution', 'reconsider', 'abort')),
  created_at TEXT NOT NULL
);

-- Oath constitutional rules
CREATE TABLE IF NOT EXISTS oath_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  layer INTEGER NOT NULL CHECK(layer BETWEEN 0 AND 3),
  description TEXT NOT NULL,
  check_fn TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_decisions_mission ON decisions(mission_id);
CREATE INDEX IF NOT EXISTS idx_analyses_decision ON vector_analyses(decision_id);
CREATE INDEX IF NOT EXISTS idx_oath_rules_active ON oath_rules(active, layer);
