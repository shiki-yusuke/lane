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

export interface GateContext {
  phase: Phase;
  targetPhase: Phase;
  event: "phase_advance" | "before_pr_publish";
  state: LaneState;
  artifacts: GateArtifacts;
  profile: Profile;
}

export type GateResult = { pass: true } | { pass: false; reason: string };

export interface Gate {
  id: string;
  appliesTo(ctx: GateContext): boolean;
  evaluate(ctx: GateContext): GateResult;
}

/**
 * design.md §3.3/§5.3 — hard gate binding reviewer_ack to the exact spec/verification
 * content it was given. Evaluated at before_pr_publish and again at 4_verify->5_done (a
 * spec.md edit made after the PR was opened but before merge must still be caught).
 */
export const specConsensusGate: Gate = {
  id: "spec_consensus",
  appliesTo: (ctx) => ctx.event === "before_pr_publish" || ctx.targetPhase === "5_done",
  evaluate: (ctx) => {
    const consensus = ctx.artifacts.verification?.spec_consensus;
    if (!consensus) return { pass: false, reason: "spec_consensus is not filled in" };
    if (
      ctx.artifacts.specDigest &&
      (consensus.spec_digest !== ctx.artifacts.specDigest.spec ||
        consensus.verification_digest !== ctx.artifacts.specDigest.verification)
    ) {
      return {
        pass: false,
        reason: "spec/verification content changed after the ack (digest mismatch)",
      };
    }
    const pending = consensus.deviations.filter((d) => d.status === "pending");
    if (pending.length > 0) {
      return { pass: false, reason: `${pending.length} unresolved deviation(s)` };
    }
    const effectiveRisk =
      ctx.state.effective_risk_log.at(-1)?.effective_risk ??
      ctx.artifacts.intent.intent.declared_risk;
    if (
      effectiveRisk === "high" &&
      consensus.reviewer_ack?.reviewer_kind === "self" &&
      !consensus.reviewer_ack.override_reason
    ) {
      return {
        pass: false,
        reason: "effective risk=high requires override_reason for a self ack",
      };
    }
    if (!consensus.reviewer_ack) return { pass: false, reason: "reviewer_ack is not filled in" };
    return { pass: true };
  },
};

/** Evaluates every registered gate that applies to this context; short-circuits on the first failure. */
export function evaluateGates(gates: readonly Gate[], ctx: GateContext): GateResult {
  for (const gate of gates) {
    if (!gate.appliesTo(ctx)) continue;
    const result = gate.evaluate(ctx);
    if (!result.pass) return result;
  }
  return { pass: true };
}

/** M1 default registry. M2/M3 gates (usage-import gate wiring, isomorphism check, etc.) register here too. */
export const DEFAULT_GATES: readonly Gate[] = [specConsensusGate];
