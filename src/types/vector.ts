import { z } from "zod";

// VECTOR Framework Stages: V-E-C-T-O-R
export const VectorStage = z.enum(["visualize", "evaluate", "choose", "test", "optimize", "review"]);
export type VectorStage = z.infer<typeof VectorStage>;

export const DecisionStakes = z.enum(["low", "medium", "high"]);
export type DecisionStakes = z.infer<typeof DecisionStakes>;

// Decision input — what needs to be analyzed
export const DecisionSchema = z.object({
  id: z.string(),
  mission_id: z.string().nullable(),
  title: z.string().min(1),
  context: z.string().min(1),
  constraints: z.array(z.string()),
  time_horizon: z.string(),
  stakes: DecisionStakes,
  confidence_level: z.number().int().min(1).max(10),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Decision = z.infer<typeof DecisionSchema>;

// VECTOR analysis output — strict JSON from each stage
export const VisualizeOutputSchema = z.object({
  success_state: z.string(),
  failure_state: z.string(),
  hidden_costs: z.array(z.string()),
});

export const EvaluateOutputSchema = z.object({
  system_dependencies: z.array(z.string()),
  second_order_effects: z.array(z.string()),
  constraint_conflicts: z.array(z.string()),
});

export const ChooseOutputSchema = z.object({
  reversibility_score: z.number().int().min(0).max(10),
  optionality_score: z.number().int().min(0).max(10),
  capital_intensity: z.enum(["low", "medium", "high"]),
  risk_profile: z.string(),
});

export const TestOutputSchema = z.object({
  minimum_viable_test: z.string(),
  success_metric: z.string(),
  kill_signal: z.string(),
  timeframe: z.string(),
});

export const OptimizeOutputSchema = z.object({
  friction_points: z.array(z.string()),
  automation_candidates: z.array(z.string()),
  assumption_risks: z.array(z.string()),
});

export const ReviewOutputSchema = z.object({
  recommended_checkpoints_days: z.array(z.number().int().positive()),
  review_questions: z.array(z.string()),
});

// Bias risk scoring — 5 dimensions, 0-10 scale
export const BiasRiskSchema = z.object({
  overconfidence: z.number().int().min(0).max(10),
  sunk_cost: z.number().int().min(0).max(10),
  confirmation_bias: z.number().int().min(0).max(10),
  urgency_distortion: z.number().int().min(0).max(10),
  complexity_underestimation: z.number().int().min(0).max(10),
});
export type BiasRisk = z.infer<typeof BiasRiskSchema>;

// Complete VECTOR analysis result
export const VectorAnalysisSchema = z.object({
  id: z.string(),
  decision_id: z.string(),
  visualize: VisualizeOutputSchema,
  evaluate: EvaluateOutputSchema,
  choose: ChooseOutputSchema,
  test: TestOutputSchema,
  optimize: OptimizeOutputSchema,
  review: ReviewOutputSchema,
  bias_risk: BiasRiskSchema,
  model_used: z.string(),
  total_risk_score: z.number().min(0).max(50),
  recommendation: z.enum(["proceed", "proceed_with_caution", "reconsider", "abort"]),
  created_at: z.string(),
});
export type VectorAnalysis = z.infer<typeof VectorAnalysisSchema>;

// Oath constitutional rule
export const OathRuleSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  layer: z.number().int().min(0).max(3),
  description: z.string(),
  check_fn: z.string(), // serialized check logic identifier
  active: z.boolean(),
});
export type OathRule = z.infer<typeof OathRuleSchema>;
