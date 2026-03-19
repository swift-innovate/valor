import { z } from "zod";
import { AgentRuntime } from "./agent.js";

export const AgentCardStatus = z.enum(["pending", "approved", "rejected", "revoked"]);
export type AgentCardStatus = z.infer<typeof AgentCardStatus>;

export const AgentCardSchema = z.object({
  id: z.string(),

  // Identity
  callsign: z.string().min(1),
  name: z.string().min(1),
  operator: z.string().min(1),
  version: z.string().default("1.0.0"),

  // Capabilities
  primary_skills: z.array(z.string()),
  runtime: AgentRuntime,
  model: z.string().nullable(),
  endpoint_url: z.string().nullable(),

  // Description
  description: z.string(),

  // Governance
  approval_status: AgentCardStatus,
  approved_by: z.string().nullable(),
  approved_at: z.string().nullable(),
  rejection_reason: z.string().nullable(),

  // Link to agent created on approval
  agent_id: z.string().nullable(),

  // Metadata
  submitted_at: z.string(),
  updated_at: z.string(),
});
export type AgentCard = z.infer<typeof AgentCardSchema>;
