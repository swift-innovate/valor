/**
 * VALOR Analyst — Verdict Logic
 *
 * Handles post-LLM verdict parsing, retry dispatch, escalation,
 * and Principal notification.
 */

import {
  publishReviewVerdict,
  publishMissionBrief,
} from "../nats/index.js";
import type { NatsConnection } from "@nats-io/nats-core";
import type {
  MissionBrief,
  ReviewVerdict,
  ReviewSubmission,
} from "../nats/index.js";
import { logger } from "../utils/logger.js";

export type VerdictDecision = "APPROVE" | "RETRY" | "ESCALATE";

export interface CriterionResult {
  criterion: string;
  passed: boolean;
  note?: string;
}

export interface AnalystVerdict {
  decision: VerdictDecision;
  reasoning: string;
  issues: string[];
  instructions: string | null;
  criteria_results: CriterionResult[];
  confidence: "high" | "medium" | "low";
}

/** Maximum retries before auto-escalating to Principal */
export const MAX_RETRIES = 2;

/**
 * Parse and validate LLM output as an AnalystVerdict.
 * Returns null if output cannot be parsed — caller should ESCALATE.
 */
export function parseVerdict(raw: string): AnalystVerdict | null {
  // Strip markdown code fences if present
  const cleaned = raw
    .replace(/^```json\s*/m, "")
    .replace(/^```\s*/m, "")
    .replace(/```\s*$/m, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as Partial<AnalystVerdict>;

    if (!["APPROVE", "RETRY", "ESCALATE"].includes(parsed.decision ?? "")) {
      logger.warn("Analyst LLM returned invalid decision", { raw: raw.slice(0, 200) });
      return null;
    }

    return {
      decision: parsed.decision as VerdictDecision,
      reasoning: parsed.reasoning ?? "(no reasoning provided)",
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      instructions: parsed.instructions ?? null,
      criteria_results: Array.isArray(parsed.criteria_results) ? parsed.criteria_results : [],
      confidence: parsed.confidence ?? "medium",
    };
  } catch {
    logger.warn("Analyst LLM output is not valid JSON", { raw: raw.slice(0, 200) });
    return null;
  }
}

/**
 * Handle APPROVE verdict:
 * - Publish ReviewVerdict with APPROVE
 * - Log completion
 */
export async function handleApprove(
  nc: NatsConnection,
  submission: ReviewSubmission,
  verdict: AnalystVerdict,
  analystCallsign: string,
): Promise<void> {
  const reviewVerdict: ReviewVerdict = {
    mission_id: submission.mission_id,
    reviewer: analystCallsign,
    decision: "APPROVE",
    reasoning: verdict.reasoning,
    issues: verdict.issues,
    instructions: null,
    escalation_target: null,
    reviewed_at: new Date().toISOString(),
  };

  await publishReviewVerdict(nc, analystCallsign, reviewVerdict);

  logger.info("Mission APPROVED", {
    mission_id: submission.mission_id,
    operative: submission.operative,
    confidence: verdict.confidence,
    issues: verdict.issues.length,
  });
}

/**
 * Handle RETRY verdict:
 * - Publish ReviewVerdict with RETRY
 * - Re-dispatch mission to operative with retry instructions appended
 * - Increment retry count in context_refs
 */
export async function handleRetry(
  nc: NatsConnection,
  submission: ReviewSubmission,
  originalBrief: MissionBrief,
  verdict: AnalystVerdict,
  retryCount: number,
  analystCallsign: string,
): Promise<void> {
  const reviewVerdict: ReviewVerdict = {
    mission_id: submission.mission_id,
    reviewer: analystCallsign,
    decision: "RETRY",
    reasoning: verdict.reasoning,
    issues: verdict.issues,
    instructions: verdict.instructions,
    escalation_target: null,
    reviewed_at: new Date().toISOString(),
  };

  await publishReviewVerdict(nc, analystCallsign, reviewVerdict);

  logger.info("Mission RETRY dispatched", {
    mission_id: submission.mission_id,
    operative: submission.operative,
    retry_count: retryCount + 1,
    issues: verdict.issues,
  });

  // Re-dispatch to operative with retry instructions appended to description
  const retryBrief: MissionBrief = {
    ...originalBrief,
    description: `${originalBrief.description}

---
## RETRY INSTRUCTIONS (Attempt ${retryCount + 1}/${MAX_RETRIES})

The Analyst reviewed your previous submission and found issues. Please address:

${verdict.issues.map((issue, i) => `${i + 1}. ${issue}`).join("\n")}

${verdict.instructions ?? ""}

Resubmit when corrected.`,
    context_refs: [
      ...originalBrief.context_refs,
      `retry:${retryCount + 1}`,
    ],
    created_at: new Date().toISOString(),
  };

  await publishMissionBrief(nc, analystCallsign, retryBrief);
}

/**
 * Handle ESCALATE verdict:
 * - Publish ReviewVerdict with ESCALATE
 * - Log for Principal notification (Telegram gateway picks this up)
 */
export async function handleEscalate(
  nc: NatsConnection,
  submission: ReviewSubmission,
  verdict: AnalystVerdict | null,
  reason: string,
  analystCallsign: string,
): Promise<void> {
  const escalationTarget = "director";

  const reviewVerdict: ReviewVerdict = {
    mission_id: submission.mission_id,
    reviewer: analystCallsign,
    decision: "ESCALATE",
    reasoning: verdict?.reasoning ?? reason,
    issues: verdict?.issues ?? [reason],
    instructions: verdict?.instructions ?? reason,
    escalation_target: escalationTarget,
    reviewed_at: new Date().toISOString(),
  };

  await publishReviewVerdict(nc, analystCallsign, reviewVerdict);

  logger.warn("Mission ESCALATED to Principal", {
    mission_id: submission.mission_id,
    operative: submission.operative,
    reason,
    escalation_target: escalationTarget,
  });
}

/**
 * Auto-escalate when retry limit is exceeded.
 */
export async function handleRetryLimitExceeded(
  nc: NatsConnection,
  submission: ReviewSubmission,
  lastVerdict: AnalystVerdict,
  analystCallsign: string,
): Promise<void> {
  const reason = `Maximum retries (${MAX_RETRIES}) exceeded. Mission requires Principal review.`;

  await handleEscalate(
    nc,
    submission,
    {
      ...lastVerdict,
      decision: "ESCALATE",
      reasoning: reason,
      instructions: `This mission was retried ${MAX_RETRIES} times without meeting acceptance criteria. Last issues: ${lastVerdict.issues.join("; ")}`,
    },
    reason,
    analystCallsign,
  );

  logger.warn("Retry limit exceeded — auto-escalated", {
    mission_id: submission.mission_id,
    max_retries: MAX_RETRIES,
  });
}
