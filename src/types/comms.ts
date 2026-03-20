import { z } from "zod";

export const CommsPriority = z.enum(["routine", "priority", "flash"]);
export type CommsPriority = z.infer<typeof CommsPriority>;

export const CommsCategory = z.enum([
  "task_handoff",
  "status_update",
  "request",
  "response",
  "escalation",
  "advisory",
  "coordination",
]);
export type CommsCategory = z.infer<typeof CommsCategory>;

export const CommsMessageSchema = z.object({
  // Routing
  from_agent_id: z.string(),
  to_agent_id: z.string().nullable(),
  to_division_id: z.string().nullable(),

  // Content
  subject: z.string(),
  body: z.string(),
  priority: CommsPriority,

  // Threading
  conversation_id: z.string(),
  in_reply_to: z.string().nullable(),

  // Classification
  category: CommsCategory,

  // Attachments — artifact IDs to display inline with this message
  attachments: z.array(z.string()).default([]),
});
export type CommsMessage = z.infer<typeof CommsMessageSchema>;

export const CommsConversationSchema = z.object({
  conversation_id: z.string(),
  participants: z.array(z.string()),
  message_count: z.number(),
  last_message_at: z.string(),
  has_flash: z.boolean(),
  latest_subject: z.string().nullable(),
  latest_body_preview: z.string().nullable(),
});
export type CommsConversation = z.infer<typeof CommsConversationSchema>;
