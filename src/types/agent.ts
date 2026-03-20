import { z } from "zod";

export const AgentStatus = z.enum([
  "registered",
  "healthy",
  "degraded",
  "offline",
  "deregistered",
]);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const AgentRuntime = z.enum([
  "openclaw",
  "ollama",
  "claude_api",
  "openai_api",
  "custom",
]);
export type AgentRuntime = z.infer<typeof AgentRuntime>;

export const AgentSchema = z.object({
  id: z.string(),
  callsign: z.string().min(1),
  division_id: z.string().nullable(),
  runtime: AgentRuntime,
  endpoint_url: z.string().nullable(),
  model: z.string().nullable(),
  health_status: AgentStatus,
  last_heartbeat: z.string().nullable(),
  persona_id: z.string().nullable(),
  capabilities: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Agent = z.infer<typeof AgentSchema>;
