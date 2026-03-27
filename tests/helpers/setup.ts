// This file runs before any test module is imported.
// Set the test DB path before config.ts is evaluated so tests
// never touch the production ./data/valor.db file.
process.env.VALOR_DB_PATH = ":memory:";
process.env.LOG_LEVEL = "error";
process.env.DISABLED_GATES = "artifact_integrity,oath,vector_checkpoint";
process.env.VALOR_ALLOW_ROLE_HEADER_FALLBACK = "true";
delete process.env.VALOR_AGENT_KEY;
