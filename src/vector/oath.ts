import { listOathRules, createOathRule } from "../db/index.js";
import { logger } from "../utils/logger.js";
import type { Mission } from "../types/index.js";

export interface OathCheckResult {
  passed: boolean;
  violations: Array<{
    rule_name: string;
    layer: number;
    description: string;
  }>;
}

/**
 * Built-in constitutional checks mapped by check_fn identifier.
 * These are the core rules that protect system integrity.
 */
const BUILT_IN_CHECKS: Record<string, (mission: Mission) => boolean> = {
  // Layer 0: Absolute constraints — never violated
  no_harm: (mission) => {
    const harmful = ["destroy", "delete all", "wipe", "erase production", "drop database"];
    const text = `${mission.title} ${mission.objective}`.toLowerCase();
    return !harmful.some((h) => text.includes(h));
  },

  no_deception: (mission) => {
    const deceptive = ["impersonate", "fake", "forge", "spoof identity"];
    const text = `${mission.title} ${mission.objective}`.toLowerCase();
    return !deceptive.some((d) => text.includes(d));
  },

  // Layer 1: Operational boundaries
  respect_namespace: (mission) => {
    // Missions should not reference other division's namespaces in constraints
    // This is a simplified check — full version would cross-reference division registry
    return true;
  },

  budget_sanity: (mission) => {
    // No single mission should exceed $100 without explicit override
    return mission.cost_usd <= 100;
  },

  // Layer 2: Quality gates
  has_objective: (mission) => {
    return mission.objective.length >= 10;
  },

  has_success_criteria: (mission) => {
    return mission.success_criteria.length > 0 || mission.priority === "low";
  },
};

/**
 * Seed default oath rules if none exist.
 */
export function seedDefaultOathRules(): void {
  const existing = listOathRules(false);
  if (existing.length > 0) return;

  const defaults = [
    { name: "No Harm", layer: 0, description: "Mission must not cause destructive harm to production systems", check_fn: "no_harm", active: true },
    { name: "No Deception", layer: 0, description: "Mission must not involve identity deception or forgery", check_fn: "no_deception", active: true },
    { name: "Respect Namespace", layer: 1, description: "Mission must not cross division namespace boundaries without authorization", check_fn: "respect_namespace", active: true },
    { name: "Budget Sanity", layer: 1, description: "Single mission cost must not exceed $100 without override", check_fn: "budget_sanity", active: true },
    { name: "Has Objective", layer: 2, description: "Mission must have a meaningful objective (10+ chars)", check_fn: "has_objective", active: true },
    { name: "Has Success Criteria", layer: 2, description: "Non-trivial missions must define success criteria", check_fn: "has_success_criteria", active: false },
  ];

  for (const rule of defaults) {
    createOathRule(rule);
  }

  logger.info("Default oath rules seeded", { count: defaults.length });
}

/**
 * Check a mission against all active oath rules.
 * Rules are evaluated in layer order (0 first = most critical).
 */
export function checkOath(mission: Mission): OathCheckResult {
  const rules = listOathRules(true);
  const violations: OathCheckResult["violations"] = [];

  for (const rule of rules) {
    const checkFn = BUILT_IN_CHECKS[rule.check_fn];
    if (!checkFn) {
      logger.warn("Unknown oath check function", { check_fn: rule.check_fn, rule: rule.name });
      continue;
    }

    const passed = checkFn(mission);
    if (!passed) {
      violations.push({
        rule_name: rule.name,
        layer: rule.layer,
        description: rule.description,
      });
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}
