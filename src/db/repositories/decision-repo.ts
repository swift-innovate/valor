import { nanoid } from "nanoid";
import { getDb } from "../database.js";
import {
  type Decision, DecisionSchema,
  type VectorAnalysis, VectorAnalysisSchema,
  type OathRule, OathRuleSchema,
} from "../../types/index.js";

function generateDecisionId(): string {
  return `dec_${nanoid(21)}`;
}

function generateAnalysisId(): string {
  return `van_${nanoid(21)}`;
}

function generateOathId(): string {
  return `oat_${nanoid(21)}`;
}

function rowToDecision(row: Record<string, unknown>): Decision {
  return DecisionSchema.parse({
    ...row,
    constraints: JSON.parse(row.constraints as string),
  });
}

function rowToAnalysis(row: Record<string, unknown>): VectorAnalysis {
  return VectorAnalysisSchema.parse({
    ...row,
    visualize: JSON.parse(row.visualize as string),
    evaluate: JSON.parse(row.evaluate as string),
    choose: JSON.parse(row.choose as string),
    test: JSON.parse(row.test as string),
    optimize: JSON.parse(row.optimize as string),
    review: JSON.parse(row.review as string),
    bias_risk: JSON.parse(row.bias_risk as string),
  });
}

function rowToOathRule(row: Record<string, unknown>): OathRule {
  return OathRuleSchema.parse({
    ...row,
    active: row.active === 1,
  });
}

// --- Decision CRUD ---

export function createDecision(
  input: Omit<Decision, "id" | "created_at" | "updated_at">,
): Decision {
  const now = new Date().toISOString();
  const id = generateDecisionId();

  getDb()
    .prepare(
      `INSERT INTO decisions (id, mission_id, title, context, constraints, time_horizon, stakes, confidence_level, created_at, updated_at)
       VALUES (@id, @mission_id, @title, @context, @constraints, @time_horizon, @stakes, @confidence_level, @created_at, @updated_at)`,
    )
    .run({
      id,
      mission_id: input.mission_id,
      title: input.title,
      context: input.context,
      constraints: JSON.stringify(input.constraints),
      time_horizon: input.time_horizon,
      stakes: input.stakes,
      confidence_level: input.confidence_level,
      created_at: now,
      updated_at: now,
    });

  return DecisionSchema.parse({ ...input, id, created_at: now, updated_at: now });
}

export function getDecision(id: string): Decision | null {
  const row = getDb().prepare("SELECT * FROM decisions WHERE id = @id").get({ id });
  return row ? rowToDecision(row as Record<string, unknown>) : null;
}

export function listDecisions(filters?: { mission_id?: string }): Decision[] {
  let sql = "SELECT * FROM decisions";
  const params: Record<string, unknown> = {};

  if (filters?.mission_id) {
    sql += " WHERE mission_id = @mission_id";
    params.mission_id = filters.mission_id;
  }

  sql += " ORDER BY created_at DESC";
  const rows = getDb().prepare(sql).all(params);
  return rows.map((r) => rowToDecision(r as Record<string, unknown>));
}

// --- Analysis CRUD ---

export function createAnalysis(
  input: Omit<VectorAnalysis, "id" | "created_at">,
): VectorAnalysis {
  const now = new Date().toISOString();
  const id = generateAnalysisId();

  getDb()
    .prepare(
      `INSERT INTO vector_analyses (id, decision_id, visualize, evaluate, choose, test, optimize, review, bias_risk, model_used, total_risk_score, recommendation, created_at)
       VALUES (@id, @decision_id, @visualize, @evaluate, @choose, @test, @optimize, @review, @bias_risk, @model_used, @total_risk_score, @recommendation, @created_at)`,
    )
    .run({
      id,
      decision_id: input.decision_id,
      visualize: JSON.stringify(input.visualize),
      evaluate: JSON.stringify(input.evaluate),
      choose: JSON.stringify(input.choose),
      test: JSON.stringify(input.test),
      optimize: JSON.stringify(input.optimize),
      review: JSON.stringify(input.review),
      bias_risk: JSON.stringify(input.bias_risk),
      model_used: input.model_used,
      total_risk_score: input.total_risk_score,
      recommendation: input.recommendation,
      created_at: now,
    });

  return VectorAnalysisSchema.parse({ ...input, id, created_at: now });
}

export function getAnalysis(id: string): VectorAnalysis | null {
  const row = getDb().prepare("SELECT * FROM vector_analyses WHERE id = @id").get({ id });
  return row ? rowToAnalysis(row as Record<string, unknown>) : null;
}

export function getAnalysisForDecision(decisionId: string): VectorAnalysis | null {
  const row = getDb()
    .prepare("SELECT * FROM vector_analyses WHERE decision_id = @decision_id ORDER BY created_at DESC LIMIT 1")
    .get({ decision_id: decisionId });
  return row ? rowToAnalysis(row as Record<string, unknown>) : null;
}

export function listAnalyses(limit?: number): VectorAnalysis[] {
  const sql = `SELECT * FROM vector_analyses ORDER BY created_at DESC${limit ? ` LIMIT ${limit}` : ""}`;
  const rows = getDb().prepare(sql).all();
  return rows.map((r) => rowToAnalysis(r as Record<string, unknown>));
}

// --- Oath Rules ---

export function createOathRule(
  input: Omit<OathRule, "id">,
): OathRule {
  const id = generateOathId();

  getDb()
    .prepare(
      `INSERT INTO oath_rules (id, name, layer, description, check_fn, active)
       VALUES (@id, @name, @layer, @description, @check_fn, @active)`,
    )
    .run({
      id,
      name: input.name,
      layer: input.layer,
      description: input.description,
      check_fn: input.check_fn,
      active: input.active ? 1 : 0,
    });

  return OathRuleSchema.parse({ ...input, id });
}

export function listOathRules(activeOnly = true): OathRule[] {
  const sql = activeOnly
    ? "SELECT * FROM oath_rules WHERE active = 1 ORDER BY layer, name"
    : "SELECT * FROM oath_rules ORDER BY layer, name";
  const rows = getDb().prepare(sql).all();
  return rows.map((r) => rowToOathRule(r as Record<string, unknown>));
}
