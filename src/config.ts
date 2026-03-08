import { z } from "zod";

const ConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(3200),
  dbPath: z.string().min(1).default("./data/valor.db"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  anthropicApiKey: z.string().optional(),
  herdBaseUrl: z.string().optional(),
  herdStatusUrl: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export const config: Config = ConfigSchema.parse({
  port: process.env.VALOR_PORT,
  dbPath: process.env.VALOR_DB_PATH,
  logLevel: process.env.LOG_LEVEL,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  herdBaseUrl: process.env.HERD_BASE_URL,
  herdStatusUrl: process.env.HERD_STATUS_URL,
});
