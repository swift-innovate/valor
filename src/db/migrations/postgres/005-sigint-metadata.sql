-- Phase 0: SIGINT integration metadata (Postgres dialect)
ALTER TABLE missions ADD COLUMN IF NOT EXISTS source_metadata TEXT;
