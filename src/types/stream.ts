import { z } from "zod";

export const StreamHealth = z.enum(["healthy", "degraded", "stalled", "failed"]);
export type StreamHealth = z.infer<typeof StreamHealth>;

export const StreamEventType = z.enum([
  "token",
  "heartbeat",
  "tool_use",
  "completion",
  "error",
]);
export type StreamEventType = z.infer<typeof StreamEventType>;

export const StreamEventSchema = z.object({
  session_id: z.string(),
  sequence: z.number().int().nonnegative(),
  event_type: StreamEventType,
  data: z.record(z.unknown()),
  timestamp: z.string(),
});
export type StreamEvent = z.infer<typeof StreamEventSchema>;

export const HeartbeatConfigSchema = z.object({
  interval_ms: z.number().int().positive().default(5000),
  timeout_ms: z.number().int().positive().default(30000),
  max_missed: z.number().int().positive().default(3),
});
export type HeartbeatConfig = z.infer<typeof HeartbeatConfigSchema>;
