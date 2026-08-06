import type { Critic, Intent, LaneState, Phase, Profile, Verification } from "@lane/schemas";

// design.md §3.3 — rev1's GateContext read `ctx.state.verification`, a field LaneState
// never actually had (sol: "動かないコード"). Gates now receive schema-validated artifacts
// explicitly instead of reaching into ad hoc state.

export interface GateArtifacts {
  intent: Intent;
  critic?: Critic;
  verification?: Verification;
  /** sha256 of the current spec.md/verification.yaml content, computed fresh by the caller. */
  specDigest?: { spec: string; verification: string };
}

/**
 * Gate-port review (2026-08-06) — replaces the old flat `{ phase, targetPhase, event }`
 * shape with a discriminated union so a gate's `appliesTo` can't be handed a nonsensical
 * combination (e.g. an `event: "before_pr_publish"` alongside an unrelated `targetPhase`
 * that was never actually the transition being attempted). `phase_advance` is the one real
 * edge (`from` -> `to`) an `advance` call is attempting; `before_pr_publish` is the
 * standalone pre-publish checkpoint `validate` evaluates independently of any specific
 * transition (see packages/cli/src/gate-check.ts).
 */
export type GateTrigger =
  | { type: "phase_advance"; from: Phase; to: Phase }
  | { type: "before_pr_publish"; phase: Phase };

export interface GateContext {
  trigger: GateTrigger;
  state: LaneState;
  artifacts: GateArtifacts;
  profile: Profile;
}

export type Severity = "warning" | "error";

/**
 * Gate-port review (2026-08-06) — replaces the old `GateResult = {pass:true} | {pass:false,
 * reason:string}` (one gate, one verdict, one reason) with an array a gate returns from
 * `evaluate()`. This exists because the ported pilot gates (premise_evidence,
 * success_criteria) can have several independent, simultaneous findings on one evaluation
 * (e.g. success_criteria_matrix can have both an uncovered intent.success line *and* a
 * covered_by:"none" row *and* a missing negation_test, all at once) — the reference
 * implementation's own gate_check_* functions accumulate a `messages: list` rather than
 * stopping at the first problem, and this type is what lets the TS port do the same
 * without losing any of them. `pass` for a whole evaluation is "no diagnostic has
 * severity 'error'" — warnings never block a transition.
 */
export interface Diagnostic {
  gateId: string;
  code: string;
  severity: Severity;
  message: string;
}

export interface Gate {
  id: string;
  appliesTo(ctx: GateContext): boolean;
  evaluate(ctx: GateContext): Diagnostic[];
}

function diagnostic(gateId: string, code: string, severity: Severity, message: string): Diagnostic {
  return { gateId, code, severity, message };
}

/**
 * design.md §3.3/§5.3 — hard gate binding reviewer_ack to the exact spec/verification
 * content it was given. Applies at the standalone before_pr_publish checkpoint once the
 * lane is actually near publish (4_verify/5_done — a before_pr_publish check while still
 * at 1_intent/2_spec/3_implement would otherwise hard-error on "spec_consensus is not
 * filled in" for a lane that was never expected to have one yet; gate-port review,
 * 2026-08-06, found by validate's own new early-phase before_pr_publish check) and again
 * at the literal 4_verify->5_done transition (a spec.md edit made after the PR was opened
 * but before merge must still be caught).
 */
export const specConsensusGate: Gate = {
  id: "spec_consensus",
  appliesTo: (ctx) =>
    (ctx.trigger.type === "before_pr_publish" &&
      (ctx.trigger.phase === "4_verify" || ctx.trigger.phase === "5_done")) ||
    (ctx.trigger.type === "phase_advance" && ctx.trigger.to === "5_done"),
  evaluate: (ctx) => {
    const consensus = ctx.artifacts.verification?.spec_consensus;
    if (!consensus) {
      return [
        diagnostic("spec_consensus", "not_filled_in", "error", "spec_consensus is not filled in"),
      ];
    }
    if (
      ctx.artifacts.specDigest &&
      (consensus.spec_digest !== ctx.artifacts.specDigest.spec ||
        consensus.verification_digest !== ctx.artifacts.specDigest.verification)
    ) {
      return [
        diagnostic(
          "spec_consensus",
          "digest_mismatch",
          "error",
          "spec/verification content changed after the ack (digest mismatch)",
        ),
      ];
    }
    const pending = consensus.deviations.filter((d) => d.status === "pending");
    if (pending.length > 0) {
      return [
        diagnostic(
          "spec_consensus",
          "unresolved_deviations",
          "error",
          `${pending.length} unresolved deviation(s)`,
        ),
      ];
    }
    const effectiveRisk =
      ctx.state.effective_risk_log.at(-1)?.effective_risk ??
      ctx.artifacts.intent.intent.declared_risk;
    if (
      effectiveRisk === "high" &&
      consensus.reviewer_ack?.reviewer_kind === "self" &&
      !consensus.reviewer_ack.override_reason
    ) {
      return [
        diagnostic(
          "spec_consensus",
          "self_ack_at_high_risk",
          "error",
          "effective risk=high requires override_reason for a self ack",
        ),
      ];
    }
    if (!consensus.reviewer_ack) {
      return [
        diagnostic("spec_consensus", "no_reviewer_ack", "error", "reviewer_ack is not filled in"),
      ];
    }
    return [];
  },
};

export interface GateEvaluation {
  diagnostics: Diagnostic[];
  pass: boolean;
}

/**
 * Evaluates every registered gate that applies to this context and collects every
 * diagnostic from all of them — a second gate whose appliesTo() is true is always
 * evaluated even if an earlier gate already produced an error (gate-port review,
 * 2026-08-06: the old version
 * short-circuited on the first failing gate, which would have hidden e.g. a
 * success_criteria error behind whichever gate happened to be checked first).
 * `pass` is true iff no diagnostic anywhere has severity "error" — warnings never block.
 */
export function evaluateGates(gates: readonly Gate[], ctx: GateContext): GateEvaluation {
  const diagnostics: Diagnostic[] = [];
  for (const gate of gates) {
    if (!gate.appliesTo(ctx)) continue;
    diagnostics.push(...gate.evaluate(ctx));
  }
  return { diagnostics, pass: diagnostics.every((d) => d.severity !== "error") };
}

/** M1 default registry. Gate-port review adds premiseEvidenceGate/successCriteriaGate here. */
export const DEFAULT_GATES: readonly Gate[] = [specConsensusGate];
