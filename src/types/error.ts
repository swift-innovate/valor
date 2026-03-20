import { z } from "zod";

export const ErrorCategory = z.enum([
  "provider",
  "state",
  "validation",
  "budget",
  "gate",
  "stream",
  "timeout",
  "oath",
]);
export type ErrorCategory = z.infer<typeof ErrorCategory>;

export const RecoveryStrategy = z.enum([
  "retry",
  "fallback_provider",
  "escalate",
  "abort",
  "queue",
]);
export type RecoveryStrategy = z.infer<typeof RecoveryStrategy>;

export const EngineErrorSchema = z.object({
  id: z.string(),
  category: ErrorCategory,
  message: z.string(),
  recoverable: z.boolean(),
  recovery_strategy: RecoveryStrategy.nullable(),
  source_agent_id: z.string().nullable(),
  mission_id: z.string().nullable(),
  context: z.record(z.unknown()).nullable(),
  timestamp: z.string(),
});
export type EngineError = z.infer<typeof EngineErrorSchema>;
