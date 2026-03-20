import { z } from "zod";

const ConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(3200),
  dbPath: z.string().min(1).default("./data/valor.db"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  anthropicApiKey: z.string().optional(),
  ollamaBaseUrl: z.string().optional(),
  ollamaStatusUrl: z.string().optional(),
  sigintUrl: z.string().url().default("http://localhost:8082"),
  disabledGates: z
    .string()
    .default("artifact_integrity,oath,vector_checkpoint")
    .transform((s) => s.split(",").map((g) => g.trim()).filter(Boolean)),
});

export type Config = z.infer<typeof ConfigSchema>;

export const config: Config = ConfigSchema.parse({
  port: process.env.VALOR_PORT,
  dbPath: process.env.VALOR_DB_PATH,
  logLevel: process.env.LOG_LEVEL,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
  ollamaStatusUrl: process.env.OLLAMA_STATUS_URL,
  sigintUrl: process.env.SIGINT_URL,
  disabledGates: process.env.DISABLED_GATES,
});
