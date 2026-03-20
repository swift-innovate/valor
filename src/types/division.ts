import { z } from "zod";

export const AutonomyPolicySchema = z.object({
  max_cost_autonomous_usd: z.number().nonnegative(),
  approval_required_actions: z.array(z.string()),
  auto_dispatch_enabled: z.boolean(),
});
export type AutonomyPolicy = z.infer<typeof AutonomyPolicySchema>;

export const EscalationPolicySchema = z.object({
  escalate_to: z.string(),
  escalate_after_failures: z.number().int().positive(),
  escalate_on_budget_breach: z.boolean(),
});
export type EscalationPolicy = z.infer<typeof EscalationPolicySchema>;

export const DivisionSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  lead_agent_id: z.string().nullable(),
  autonomy_policy: AutonomyPolicySchema,
  escalation_policy: EscalationPolicySchema,
  namespace: z.string().min(1),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Division = z.infer<typeof DivisionSchema>;

export const DivisionRole = z.enum(["lead", "member", "operative"]);
export type DivisionRole = z.infer<typeof DivisionRole>;

export const DivisionMemberSchema = z.object({
  id: z.string(),
  division_id: z.string(),
  agent_id: z.string(),
  role: DivisionRole,
  assigned_at: z.string(),
  assigned_by: z.string(),
});
export type DivisionMember = z.infer<typeof DivisionMemberSchema>;

export const DivisionRosterEntrySchema = DivisionMemberSchema.extend({
  callsign: z.string(),
  health_status: z.string(),
});
export type DivisionRosterEntry = z.infer<typeof DivisionRosterEntrySchema>;

export const AgentDivisionEntrySchema = z.object({
  division_id: z.string(),
  division_name: z.string(),
  namespace: z.string(),
  role: DivisionRole,
});
export type AgentDivisionEntry = z.infer<typeof AgentDivisionEntrySchema>;
