import { Hono } from "hono";
import { html } from "hono/html";
import { layout } from "../layout.js";
import { listDecisions, getAnalysisForDecision } from "../../db/index.js";
import type { Decision, VectorAnalysis, BiasRisk } from "../../types/index.js";

export const decisionsPage = new Hono();

function stakesBadge(stakes: Decision["stakes"]) {
  const colors: Record<string, string> = {
    low: "bg-green-900 text-green-300 border-green-700",
    medium: "bg-yellow-900 text-yellow-300 border-yellow-700",
    high: "bg-red-900 text-red-300 border-red-700",
  };
  return html`<span class="text-xs font-medium px-2 py-0.5 rounded-full border ${colors[stakes] ?? colors.low}">${stakes}</span>`;
}

function recommendationBadge(rec: VectorAnalysis["recommendation"]) {
  const colors: Record<string, string> = {
    proceed: "bg-green-900 text-green-300 border-green-700",
    proceed_with_caution: "bg-yellow-900 text-yellow-300 border-yellow-700",
    reconsider: "bg-orange-900 text-orange-300 border-orange-700",
    abort: "bg-red-900 text-red-300 border-red-700",
  };
  const labels: Record<string, string> = {
    proceed: "Proceed",
    proceed_with_caution: "Proceed with Caution",
    reconsider: "Reconsider",
    abort: "Abort",
  };
  return html`<span class="text-xs font-medium px-2 py-0.5 rounded-full border ${colors[rec] ?? colors.proceed}">${labels[rec] ?? rec}</span>`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
}

function biasBar(label: string, score: number) {
  const pct = (score / 10) * 100;
  return html`
    <div class="flex items-center gap-2 text-xs">
      <span class="w-32 text-gray-400">${label}</span>
      <div class="flex-1 bg-gray-800 rounded-full h-2">
        <div class="h-2 rounded-full bg-valor-500" style="width: ${pct}%"></div>
      </div>
      <span class="text-gray-500 w-6 text-right">${score}</span>
    </div>`;
}

function riskProgressBar(score: number) {
  const pct = (score / 50) * 100;
  const color =
    score <= 15 ? "bg-green-500" :
    score <= 30 ? "bg-yellow-500" :
    score <= 40 ? "bg-orange-500" :
    "bg-red-500";
  return html`
    <div class="flex items-center gap-3">
      <span class="text-xs text-gray-400 w-24">Risk Score</span>
      <div class="flex-1 bg-gray-800 rounded-full h-3">
        <div class="h-3 rounded-full ${color}" style="width: ${pct}%"></div>
      </div>
      <span class="text-sm font-mono text-gray-300">${score}/50</span>
    </div>`;
}

function analysisSection(analysis: VectorAnalysis) {
  const bias = analysis.bias_risk;
  const biasLabels: [keyof BiasRisk, string][] = [
    ["overconfidence", "Overconfidence"],
    ["sunk_cost", "Sunk Cost"],
    ["confirmation_bias", "Confirmation Bias"],
    ["urgency_distortion", "Urgency Distortion"],
    ["complexity_underestimation", "Complexity Underest."],
  ];

  return html`
    <div class="mt-4 pt-4 border-t border-gray-800 space-y-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-xs text-gray-500 uppercase tracking-wide">Analysis</span>
          ${recommendationBadge(analysis.recommendation)}
        </div>
        <span class="text-xs text-gray-600">Model: ${analysis.model_used}</span>
      </div>

      ${riskProgressBar(analysis.total_risk_score)}

      <div class="space-y-1.5 mt-2">
        <span class="text-xs text-gray-500 uppercase tracking-wide">Bias Risk Breakdown</span>
        ${biasLabels.map(([key, label]) => biasBar(label, bias[key]))}
      </div>
    </div>`;
}

function analyzeButton(decisionId: string) {
  return html`
    <div class="mt-4 pt-4 border-t border-gray-800">
      <button
        onclick="apiCall('POST', '/decisions/${decisionId}/analyze').then(() => window.location.reload())"
        class="px-3 py-1.5 text-xs font-medium rounded-md bg-valor-700 text-white hover:bg-valor-600 transition-colors">
        Analyze
      </button>
    </div>`;
}

function decisionCard(d: Decision, analysis: VectorAnalysis | null) {
  return html`
    <div class="bg-gray-900 rounded-lg border border-gray-800 p-4 fade-in">
      <div class="flex items-start justify-between gap-3">
        <h3 class="text-sm font-semibold text-gray-100 leading-tight">${d.title}</h3>
        ${stakesBadge(d.stakes)}
      </div>

      <p class="mt-2 text-xs text-gray-400 leading-relaxed">${truncate(d.context, 100)}</p>

      <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span>Confidence: <span class="text-gray-300 font-medium">${d.confidence_level}/10</span></span>
        <span>Horizon: <span class="text-gray-300 font-medium">${d.time_horizon}</span></span>
        <span>Constraints: <span class="text-gray-300 font-medium">${d.constraints.length}</span></span>
      </div>

      ${analysis ? analysisSection(analysis) : analyzeButton(d.id)}
    </div>`;
}

decisionsPage.get("/", (c) => {
  const decisions = listDecisions();

  const content = html`
    <div class="space-y-6">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-bold text-white tracking-tight">VECTOR Decisions</h1>
        <button
          onclick="apiCall('POST', '/decisions/meta').then(r => alert(JSON.stringify(r, null, 2)))"
          class="px-4 py-2 text-sm font-medium rounded-md bg-valor-700 text-white hover:bg-valor-600 transition-colors">
          Run Meta-Analysis
        </button>
      </div>

      ${decisions.length === 0
        ? html`<p class="text-gray-500 text-sm">No decisions recorded yet.</p>`
        : html`
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            ${decisions.map((d) => {
              const analysis = getAnalysisForDecision(d.id);
              return decisionCard(d, analysis);
            })}
          </div>`
      }
    </div>`;

  return c.html(layout("Decisions", "/dashboard/decisions", content));
});
