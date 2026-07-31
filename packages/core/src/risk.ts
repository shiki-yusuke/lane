import type {
  EffectiveRiskEvaluation,
  Intent,
  LaneState,
  Profile,
  RiskLevel,
  RiskUpgradeRule,
} from "@lane/schemas";
import { computeDigest } from "./digest.js";
import { matchesGlob } from "./glob.js";

// design.md §3.4 — declared_risk (intent.intent.declared_risk) is immutable; the effective
// risk used by gates is recomputed on every gate evaluation and only ever monotonically
// increases (no implicit downgrade), recorded to LaneState.effective_risk_log for audit.

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export function maxRisk(levels: readonly RiskLevel[]): RiskLevel {
  return levels.reduce(
    (max, level) => (RISK_ORDER[level] > RISK_ORDER[max] ? level : max),
    "low" as RiskLevel,
  );
}

/**
 * A rule matches if any of its `when.layers` intersects the intent's affected_layers, or
 * any of its `when.paths` glob-matches any of the intent's allowed_paths. A rule with
 * neither criterion set (`when: {}`) never matches — an unconditional upgrade rule would
 * be indistinguishable from a typo'd empty rule, so it is treated as a no-op rather than
 * "always upgrade".
 */
export function ruleMatches(rule: RiskUpgradeRule, intent: Intent): boolean {
  const layers = rule.when.layers;
  if (layers?.some((l) => intent.ai_inferred_scope.affected_layers.includes(l))) {
    return true;
  }
  const paths = rule.when.paths;
  if (
    paths?.some((pattern) =>
      intent.ai_inferred_scope.allowed_paths.some((p) => matchesGlob(pattern, p)),
    )
  ) {
    return true;
  }
  return false;
}

export interface EffectiveRiskResult {
  effective: RiskLevel;
  appliedRuleIds: string[];
}

export function evaluateEffectiveRisk(
  declared: RiskLevel,
  previousEffective: RiskLevel | null,
  intent: Intent,
  rules: readonly RiskUpgradeRule[],
): EffectiveRiskResult {
  const matched = rules.filter((r) => ruleMatches(r, intent));
  const currentEffective = maxRisk([declared, ...matched.map((r) => r.upgrade_to)]);
  const effective = maxRisk([declared, previousEffective ?? "low", currentEffective]);
  return { effective, appliedRuleIds: matched.map((r) => r.id) };
}

/** Convenience wrapper reading rules straight from a resolved Profile. */
export function evaluateEffectiveRiskForProfile(
  declared: RiskLevel,
  previousEffective: RiskLevel | null,
  intent: Intent,
  profile: Profile,
): EffectiveRiskResult {
  return evaluateEffectiveRisk(declared, previousEffective, intent, profile.risk_auto_upgrade);
}

/**
 * Runs the effective-risk evaluation for one gate check and appends the result to
 * state.effective_risk_log (design.md §3.4: recomputed and audited on every gate
 * evaluation, monotonic, never silently downgraded). This is the wiring that was
 * previously missing (Codex M1 review, must-3): evaluateEffectiveRisk/
 * evaluateEffectiveRiskForProfile existed but nothing ever called them from the CLI's
 * gate-evaluation path, so a profile's risk_auto_upgrade rules never actually affected
 * gate outcomes — "dead config" the design was explicitly trying to avoid re-introducing
 * (the Python reference implementation's own risk_auto_upgrade had this exact problem). Callers (cli validate/
 * advance) must call this immediately before building GateContext and persist the
 * returned state so the audit trail and the gate's own risk read
 * (`state.effective_risk_log.at(-1)`) stay in sync.
 */
export function recordEffectiveRiskEvaluation(
  state: LaneState,
  intent: Intent,
  profile: Profile,
  gateId: string,
  evaluatedAt: string,
): LaneState {
  const previousEffective = state.effective_risk_log.at(-1)?.effective_risk ?? null;
  const { effective, appliedRuleIds } = evaluateEffectiveRiskForProfile(
    intent.intent.declared_risk,
    previousEffective,
    intent,
    profile,
  );
  const entry: EffectiveRiskEvaluation = {
    gate_id: gateId,
    effective_risk: effective,
    applied_rule_ids: appliedRuleIds,
    profile_digest: computeDigest(JSON.stringify(profile)),
    evaluated_at: evaluatedAt,
  };
  return { ...state, effective_risk_log: [...state.effective_risk_log, entry] };
}
