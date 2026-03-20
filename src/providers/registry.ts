import { logger } from "../utils/logger.js";
import type {
  ProviderAdapter,
  ProviderType,
  ProviderHealth,
  DispatchCriteria,
} from "./types.js";

const providers = new Map<string, ProviderAdapter>();

export function registerProvider(provider: ProviderAdapter): void {
  providers.set(provider.id, provider);
  logger.info("Provider registered", { id: provider.id, name: provider.name, type: provider.type });
}

export function getProvider(id: string): ProviderAdapter | undefined {
  return providers.get(id);
}

export function getProvidersByType(type: ProviderType): ProviderAdapter[] {
  return [...providers.values()].filter((p) => p.type === type);
}

export function getBestProvider(criteria: DispatchCriteria): ProviderAdapter | undefined {
  const candidates = [...providers.values()].filter((p) => {
    // Filter by model support.
    // Empty models list means the provider hasn't been health-checked yet —
    // treat as "accepts any model" rather than "accepts none".
    if (criteria.model && p.capabilities.models.length > 0 && !p.capabilities.models.includes(criteria.model)) return false;

    // Filter by required capabilities
    if (criteria.capabilities) {
      if (criteria.capabilities.streaming && !p.capabilities.streaming) return false;
      if (criteria.capabilities.toolUse && !p.capabilities.toolUse) return false;
      if (criteria.capabilities.vision && !p.capabilities.vision) return false;
    }

    return true;
  });

  if (candidates.length === 0) return undefined;

  // Prefer local providers (ollama) when requested
  if (criteria.preferLocal) {
    const local = candidates.find((p) => p.type === "ollama");
    if (local) return local;
  }

  return candidates[0];
}

export async function healthCheckAll(): Promise<Map<string, ProviderHealth>> {
  const results = new Map<string, ProviderHealth>();

  const checks = [...providers.entries()].map(async ([id, provider]) => {
    try {
      const health = await provider.healthCheck();
      results.set(id, health);
    } catch (err) {
      results.set(id, {
        status: "unavailable",
        latency_ms: -1,
        last_check: new Date().toISOString(),
        details: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  });

  await Promise.allSettled(checks);
  return results;
}

export function listProviders(): ProviderAdapter[] {
  return [...providers.values()];
}

export function clearProviders(): void {
  providers.clear();
}
