import { z } from "zod";
import { MissionPhase } from "./mission.js";

export const SitrepStatus = z.enum([
  "green",
  "yellow",
  "red",
  "hold",
  "escalated",
]);
export type SitrepStatus = z.infer<typeof SitrepStatus>;

export const SitrepSchema = z.object({
  id: z.string(),
  mission_id: z.string(),
  agent_id: z.string(),
  phase: MissionPhase,
  status: SitrepStatus,
  summary: z.string(),
  objectives_complete: z.array(z.string()),
  objectives_pending: z.array(z.string()),
  blockers: z.array(z.string()),
  learnings: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low", "conflicting"]),
  tokens_used: z.number().int().nonnegative(),
  delivered_to: z.array(z.string()),
  created_at: z.string(),
});
export type Sitrep = z.infer<typeof SitrepSchema>;
