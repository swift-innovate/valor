import { z } from "zod";

export const EventActorSchema = z.object({
  id: z.string(),
  type: z.enum(["agent", "director", "system", "gateway"]),
});
export type EventActor = z.infer<typeof EventActorSchema>;

export const EventEnvelopeSchema = z.object({
  id: z.string(),
  type: z.string().min(1),
  timestamp: z.string(),
  source: EventActorSchema,
  target: EventActorSchema.nullable(),
  conversation_id: z.string().nullable(),
  in_reply_to: z.string().nullable(),
  payload: z.record(z.unknown()),
  metadata: z.record(z.unknown()).nullable(),
});
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
