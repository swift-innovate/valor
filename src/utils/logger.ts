import { config } from "../config.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[config.logLevel];
}

function formatEntry(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  });
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>) {
    if (shouldLog("debug")) console.debug(formatEntry("debug", message, context));
  },
  info(message: string, context?: Record<string, unknown>) {
    if (shouldLog("info")) console.info(formatEntry("info", message, context));
  },
  warn(message: string, context?: Record<string, unknown>) {
    if (shouldLog("warn")) console.warn(formatEntry("warn", message, context));
  },
  error(message: string, context?: Record<string, unknown>) {
    if (shouldLog("error")) console.error(formatEntry("error", message, context));
  },
};
