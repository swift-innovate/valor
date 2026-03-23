import { z } from "zod";

const ConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(3200),
  dbPath: z.string().min(1).default("./data/valor.db"),
  dbBackend: z.enum(["sqlite", "postgres"]).default("sqlite"),
  dbPostgresUrl: z.string().optional(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  anthropicApiKey: z.string().optional(),
  ollamaBaseUrl: z.string().optional(),
  ollamaStatusUrl: z.string().optional(),
  sigintUrl: z.string().url().default("http://localhost:8082"),
  directorModel: z.string().default("gemma3:27b"),
  directorGear2Model: z.string().default("nemotron-cascade-2:latest"),
  directorConfidenceThreshold: z.coerce.number().min(0).max(10).default(5),
  natsUrl: z.string().default("nats://localhost:4222"),
  disabledGates: z.string().default("").transform((s) => s.split(",").map((g) => g.trim()).filter(Boolean)),
});

export type Config = z.infer<typeof ConfigSchema>;

export const config: Config = ConfigSchema.parse({
  port: process.env.VALOR_PORT,
  dbPath: process.env.VALOR_DB_PATH,
  dbBackend: process.env.DB_BACKEND,
  dbPostgresUrl: process.env.DB_POSTGRES_URL,
  logLevel: process.env.LOG_LEVEL,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
  ollamaStatusUrl: process.env.OLLAMA_STATUS_URL,
  sigintUrl: process.env.SIGINT_URL,
  directorModel: process.env.DIRECTOR_MODEL,
  directorGear2Model: process.env.DIRECTOR_GEAR2_MODEL,
  directorConfidenceThreshold: process.env.DIRECTOR_CONFIDENCE_THRESHOLD,
  natsUrl: process.env.NATS_URL,
  disabledGates: process.env.DISABLED_GATES,
});
