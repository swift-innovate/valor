import { z } from "zod";

export const WALOperation = z.enum(["create", "update", "delete"]);
export type WALOperation = z.infer<typeof WALOperation>;

export const WALEntrySchema = z.object({
  id: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  operation: WALOperation,
  before_state: z.string().nullable(),
  after_state: z.string().nullable(),
  actor_id: z.string(),
  timestamp: z.string(),
});
export type WALEntry = z.infer<typeof WALEntrySchema>;
