import { Hono } from "hono";
import {
  createDecision,
  getDecision,
  listDecisions,
  createAnalysis,
  getAnalysis,
  getAnalysisForDecision,
  listAnalyses,
} from "../db/index.js";
import { analyzeDecision, runMetaAnalysis } from "../vector/index.js";

export const decisionRoutes = new Hono();

// List decisions with optional mission_id filter
decisionRoutes.get("/", (c) => {
  const mission_id = c.req.query("mission_id");
  const decisions = listDecisions({ mission_id });
  return c.json(decisions);
});

// Get single decision
decisionRoutes.get("/:id", (c) => {
  const decision = getDecision(c.req.param("id"));
  if (!decision) return c.json({ error: "Decision not found" }, 404);
  return c.json(decision);
});

// Create decision
decisionRoutes.post("/", async (c) => {
  const body = await c.req.json();

  const decision = createDecision({
    title: body.title,
    context: body.context,
    constraints: body.constraints ?? [],
    time_horizon: body.time_horizon,
    stakes: body.stakes,
    confidence_level: body.confidence_level,
    mission_id: body.mission_id ?? null,
  });

  return c.json(decision, 201);
});

// Run VECTOR analysis on a decision
decisionRoutes.post("/:id/analyze", (c) => {
  try {
    const analysis = analyzeDecision(c.req.param("id"));
    return c.json(analysis);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

// Get latest analysis for a decision
decisionRoutes.get("/:id/analysis", (c) => {
  const analysis = getAnalysisForDecision(c.req.param("id"));
  if (!analysis) return c.json({ error: "No analysis found for this decision" }, 404);
  return c.json(analysis);
});

// Run meta-analysis across recent decisions
decisionRoutes.post("/meta", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const limit = body.limit ?? 10;

  try {
    const result = runMetaAnalysis(limit);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});
