import { z } from "zod";

export const MissionStatus = z.enum([
  "draft",
  "queued",
  "gated",
  "dispatched",
  "streaming",
  "complete",
  "aar_pending",
  "aar_complete",
  "failed",
  "aborted",
  "timed_out",
]);
export type MissionStatus = z.infer<typeof MissionStatus>;

export const MissionPhase = z.enum(["V", "A", "L", "O", "R"]);
export type MissionPhase = z.infer<typeof MissionPhase>;

export const MissionPriority = z.enum(["critical", "high", "normal", "low"]);
export type MissionPriority = z.infer<typeof MissionPriority>;

export const TokenUsageSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const MissionSchema = z.object({
  id: z.string(),
  division_id: z.string().nullable(),
  title: z.string().min(1),
  objective: z.string().min(1),
  status: MissionStatus,
  phase: MissionPhase.nullable(),
  assigned_agent_id: z.string().nullable(),
  priority: MissionPriority,
  constraints: z.array(z.string()),
  deliverables: z.array(z.string()),
  success_criteria: z.array(z.string()),
  token_usage: TokenUsageSchema.nullable(),
  cost_usd: z.number().nonnegative(),
  revision_count: z.number().int().nonnegative(),
  max_revisions: z.number().int().positive(),
  parent_mission_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  dispatched_at: z.string().nullable(),
  completed_at: z.string().nullable(),
});
export type Mission = z.infer<typeof MissionSchema>;

/** Valid status transitions. Key = current status, value = allowed next statuses. */
export const MISSION_TRANSITIONS: Record<MissionStatus, MissionStatus[]> = {
  draft: ["queued", "aborted"],
  queued: ["gated", "aborted"],
  gated: ["dispatched", "queued", "aborted"],
  dispatched: ["streaming", "failed", "aborted"],
  streaming: ["complete", "failed", "timed_out", "aborted"],
  complete: ["aar_pending"],
  aar_pending: ["aar_complete", "queued"],
  aar_complete: [],
  failed: ["queued", "aborted"],
  aborted: [],
  timed_out: ["queued", "aborted"],
};
