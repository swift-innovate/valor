-- Persona registry for SSOP-typed agent identities
CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  callsign TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('lead', 'operative', 'analyst', 'specialist')),
  division_id TEXT REFERENCES divisions(id),
  ssop_version TEXT,
  core_identity TEXT NOT NULL,       -- JSON: { mission, behavioral_directives[] }
  communication_style TEXT NOT NULL, -- JSON: { tone, formality, patterns[] }
  decision_framework TEXT NOT NULL,  -- JSON: { priorities[], constraints[], escalation_triggers[] }
  knowledge_domains TEXT NOT NULL,   -- JSON array
  operational_constraints TEXT NOT NULL, -- JSON array
  personality_traits TEXT NOT NULL,  -- JSON array
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_personas_division ON personas(division_id);
CREATE INDEX IF NOT EXISTS idx_personas_callsign ON personas(callsign);
CREATE INDEX IF NOT EXISTS idx_personas_active ON personas(active);
