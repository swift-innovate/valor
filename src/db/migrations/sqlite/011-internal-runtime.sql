-- 011: Add 'internal' agent runtime type
-- The runtime column is TEXT with no CHECK constraint, so no schema change needed.
-- This migration exists to document the addition of the 'internal' runtime value
-- for agents that execute missions in-process via the OperativeAgent loop.
-- Validation is handled by the Zod AgentRuntime enum in src/types/agent.ts.
SELECT 1;
