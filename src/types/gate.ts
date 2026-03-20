import { z } from "zod";

export const GateName = z.enum([
  "mission_state",
  "convergence",
  "revision_cap",
  "health",
  "artifact_integrity",
  "budget",
  "concurrency",
  "hil",
  "oath",
  "vector_checkpoint",
]);
export type GateName = z.infer<typeof GateName>;

export const GateVerdict = z.enum(["pass", "block", "downgrade", "escalate"]);
export type GateVerdict = z.infer<typeof GateVerdict>;

export const GateResultSchema = z.object({
  gate: GateName,
  verdict: GateVerdict,
  reason: z.string(),
  details: z.record(z.unknown()).nullable(),
  timestamp: z.string(),
});
export type GateResult = z.infer<typeof GateResultSchema>;
