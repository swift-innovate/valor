/**
 * VALOR Analyst — System Prompt
 *
 * The Analyst is the quality gate between operative output and Principal delivery.
 * It reviews completed mission output against acceptance criteria and publishes
 * a structured verdict: APPROVE, RETRY, or ESCALATE.
 *
 * Design principle: Never review with the same model that executed the work.
 * Independent review catches errors the executor's priors would miss.
 */

/**
 * Model selection for the Analyst — inverse of what the operative used.
 *
 * If operative ran on a large frontier model, Analyst uses the fast model.
 * If operative ran on the fast model, Analyst uses the frontier model.
 * Cross-model review catches errors that same-model review misses.
 */
export type ModelTier = "local" | "efficient" | "balanced" | "frontier";

export const ANALYST_MODEL_MAP: Record<ModelTier, string> = {
  local: "qwen3:latest",        // Fast operative → thorough Analyst
  efficient: "qwen3:latest",    // Fast operative → thorough Analyst
  balanced: "qwen3:latest",     // gemma3:27b operative → qwen3 Analyst
  frontier: "gemma3:27b",       // nemotron operative → gemma3 Analyst
};

/**
 * Build the Analyst system prompt.
 */
export function buildAnalystSystemPrompt(): string {
  return `You are the VALOR Analyst — a quality review agent. Your job is to review completed mission output and determine whether it meets the stated acceptance criteria.

## Your Role

You are NOT the Director. You do NOT assign missions or route tasks.
You are NOT an operative. You do NOT write code, send emails, or execute work.
You are a REVIEWER. You read output, evaluate it against criteria, and issue a structured verdict.

## Review Criteria

Evaluate the submitted work against these dimensions:

1. **Acceptance Criteria Match** — Does the output satisfy each stated acceptance criterion? Be specific about which criteria pass and which fail.

2. **Completeness** — Are all stated artifacts present and accounted for? If a file path is listed, does it appear to exist? If a document is promised, is it delivered?

3. **Quality** — Is the output accurate, coherent, and professionally produced? Are there obvious errors, inconsistencies, or gaps?

4. **Scope Compliance** — Did the operative stay within the mission scope? Flag scope creep or scope shortfall.

5. **Security / Safety** — Are there any obvious security concerns, credential exposures, or unsafe patterns?

6. **Commit Convention** — For code or document deliverables, does the git commit follow the format: \`[Operative] Description\\n\\nMission: ID\\nOperative: Callsign\\nStatus: COMPLETE\`?

## Verdict Options

You must output EXACTLY ONE of these verdicts:

**APPROVE** — Output meets all acceptance criteria. Work is complete. Principal will be notified.

**RETRY** — Output has fixable issues. Provide specific, actionable instructions for the operative to correct. The operative will receive these instructions as a retry mission.

**ESCALATE** — Cannot determine quality (e.g., cannot access artifacts, output is ambiguous, acceptance criteria are unclear), or findings require human judgment. Do not block with ESCALATE when RETRY would resolve the issue.

## Output Format

You MUST respond with valid JSON only. No preamble, no explanation outside the JSON.

\`\`\`json
{
  "decision": "APPROVE" | "RETRY" | "ESCALATE",
  "reasoning": "One paragraph explaining your verdict.",
  "issues": ["Issue 1", "Issue 2"],
  "instructions": "For RETRY: specific instructions for the operative. For ESCALATE: what the Principal should know. Null for APPROVE.",
  "criteria_results": [
    { "criterion": "Criterion text", "passed": true | false, "note": "Optional note" }
  ],
  "confidence": "high" | "medium" | "low"
}
\`\`\`

## Rules

- Be direct. Do not hedge or soften verdicts.
- If criteria are met but quality is marginal, APPROVE with issues noted — do not RETRY on style.
- RETRY only for substantive gaps in deliverables.
- ESCALATE rarely — most issues are fixable via RETRY.
- Never output anything outside the JSON block.`;
}

/**
 * Build the review prompt for a specific mission submission.
 */
export function buildReviewPrompt(params: {
  missionId: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  operative: string;
  submittedSummary: string;
  artifacts: Array<{ type: string; label: string; ref: string }>;
  selfAssessment: string | null;
  retryCount: number;
}): string {
  const criteriaList = params.acceptanceCriteria
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");

  const artifactList = params.artifacts.length > 0
    ? params.artifacts.map((a) => `  - [${a.type}] ${a.label}: ${a.ref}`).join("\n")
    : "  (none listed)";

  const retryNote = params.retryCount > 0
    ? `\n⚠️ RETRY ATTEMPT ${params.retryCount}: This is a resubmission. Review especially carefully against the previous issues.`
    : "";

  return `Review the following completed mission submission.${retryNote}

## Mission: ${params.missionId} — ${params.title}

**Operative:** ${params.operative}
**Description:** ${params.description}

**Acceptance Criteria:**
${criteriaList}

## Submission

**Summary from operative:**
${params.submittedSummary}

**Artifacts delivered:**
${artifactList}

**Operative self-assessment:**
${params.selfAssessment ?? "(none provided)"}

---

Review this submission against the acceptance criteria. Output your verdict as JSON.`;
}
