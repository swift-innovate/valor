// ─── Loop phases ────────────────────────────────────────────────────────────

export type LoopPhase = 'observe' | 'plan' | 'act' | 'validate' | 'reflect' | 'evolve';

export type PersistenceMode = 'always' | 'mission-scoped' | 'scanning' | 'on-demand';

// ─── Operative configuration ────────────────────────────────────────────────

export interface LoopConfig {
  persistence: PersistenceMode;
  tickInterval: number;           // ms between loop iterations
  maxIterationsPerMission: number;
  idleTimeout: number;            // ms before dormancy
}

export interface AutonomyConfig {
  budget: number;                 // act cycles before mandatory checkpoint
  escalationTarget: string;       // agent id to escalate to
  autoApprovePhases: LoopPhase[];
  requiresCheckpoint: LoopPhase[];
}

export interface EngramConfig {
  readDomains: string[];
  writeDomains: string[];
  recallBudget: number;           // max tokens for recall context
  retainOnPhases: LoopPhase[];
}

export interface ToolConfig {
  enabled: string[];
  disabled: string[];
}

export interface OperativeConfig {
  id: string;
  name: string;
  tier: 0 | 1 | 2 | 3;
  division?: string;
  loop: LoopConfig;
  autonomy: AutonomyConfig;
  engram: EngramConfig;
  modelAssignment: Record<string, string>; // taskType → "provider/model"
  tools: ToolConfig;
}

// ─── Mission brief (internal representation for the phase loop) ─────────────

export type InternalMissionState =
  | 'PENDING'
  | 'PENDING_APPROVAL'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'ESCALATED'
  | 'ABORTED';

export interface MissionBrief {
  missionId: string;
  title: string;
  assignedTo: string;
  assignedBy: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  strategyAlignment?: string;
  objectives: string[];
  successCriteria?: string[];
  tokenBudget?: number;
  state: InternalMissionState;
}

// ─── Phase results ──────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ObserveResult {
  phase: 'observe';
  summary: string;
  commanderInput?: string;
  engramContext?: string;
  rawMessages: ChatMessage[];
}

export interface PlanResult {
  phase: 'plan';
  reasoning: string;
  actions: PlannedAction[];
  needsEscalation: boolean;
  escalationReason?: string;
}

export interface PlannedAction {
  id: string;
  description: string;
  tool?: string;
  params?: Record<string, unknown>;
  requiresCheckpoint: boolean;
}

export interface ActResult {
  phase: 'act';
  actionId: string;
  output: string;
  success: boolean;
  error?: string;
}

export interface ValidateResult {
  phase: 'validate';
  passed: boolean;
  reasoning: string;
  retry?: boolean;
}

export interface ReflectResult {
  phase: 'reflect';
  summary: string;
  engramEntries: string[];
  missionComplete: boolean;
  missionFailed: boolean;
}

export interface EvolveResult {
  phase: 'evolve';
  assessed: boolean;
  proposals: string[];
  vectorScore?: number;
}

export type PhaseResult =
  | ObserveResult
  | PlanResult
  | ActResult
  | ValidateResult
  | ReflectResult
  | EvolveResult;

// ─── Agent state ────────────────────────────────────────────────────────────

export type AgentStatus = 'idle' | 'active' | 'dormant' | 'error' | 'terminated';

export interface AgentState {
  agentId: string;
  status: AgentStatus;
  missionId?: string;
  iterationCount: number;
  actCyclesUsed: number;
  tokensBudgetUsed: number;
  lastPhase?: LoopPhase;
  lastActivity: Date;
}

// ─── Engram adapter interface (optional — stubbed for Phase 1) ──────────────

export interface EngramAdapter {
  recall(opts: {
    agentId: string;
    domains: string[];
    query: string;
    budgetTokens: number;
  }): Promise<string>;

  retain(opts: {
    agentId: string;
    domain: string;
    type: 'world' | 'experience' | 'observation' | 'opinion';
    content: string;
    tags?: string[];
  }): Promise<string>;
}

/** No-op Engram adapter for when Engram is not configured. */
export const nullEngramAdapter: EngramAdapter = {
  async recall() { return ''; },
  async retain() { return ''; },
};

// ─── Tool adapter interface ─────────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface ToolAdapter {
  execute(tool: string, params: Record<string, unknown>): Promise<ToolResult>;
  isEnabled(tool: string): boolean;
}
