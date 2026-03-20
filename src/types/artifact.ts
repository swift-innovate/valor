import { z } from "zod";

export const ArtifactType = z.enum([
  "code",      // Source code (has language field)
  "markdown",  // Markdown document
  "config",    // Configuration (YAML, JSON, TOML, env)
  "data",      // Structured data (JSON, CSV)
  "text",      // Plain text
  "log",       // Log output
]);
export type ArtifactType = z.infer<typeof ArtifactType>;

export const ArtifactSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  content_type: ArtifactType,
  language: z.string().nullable(),  // "typescript", "python", "yaml", etc. — for syntax hints
  content: z.string(),
  summary: z.string().nullable(),
  created_by: z.string(),           // Agent ID or "director"
  conversation_id: z.string().nullable(),
  version: z.number().int().default(1),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;
