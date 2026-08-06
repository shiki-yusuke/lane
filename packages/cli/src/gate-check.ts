import {
  DEFAULT_GATES,
  type Diagnostic,
  type GateContext,
  type GateEvaluation,
  type GateTrigger,
  canonicalVerificationContent,
  computeDigest,
  evaluateGates,
} from "@lane/core";
import type { Intent, LaneState, Profile } from "@lane/schemas";
import { readCriticIfExists } from "./critic-store.js";
import { readSpecMdIfExists } from "./spec-store.js";
import { readVerificationIfExists } from "./verification-store.js";

/**
 * Shared by validate.ts and advance.ts (gate-port review, 2026-08-06: both now evaluate
 * gates on every transition/checkpoint, not just 5_done/before_pr_publish, so both need
 * the same artifact-reading + digest-computation logic — reading verification.yaml/
 * critic.yaml fresh from disk and computing spec.md/verification.yaml digests right here,
 * so a gate always checks the *current* on-disk content against whatever digest is
 * recorded in verification.yaml's spec_consensus, not a value someone forgot to refresh).
 *
 * `readCriticIfExists` throws (schema error) if critic.yaml exists but is malformed — same
 * "read-if-exists, but validate strictly when present" contract intent.yaml/
 * verification.yaml already follow.
 */
export function buildGateContext(
  specDir: string,
  intentId: string,
  state: LaneState,
  intent: Intent,
  profile: Profile,
  trigger: GateTrigger,
): GateContext {
  const verification = readVerificationIfExists(specDir, intentId);
  const critic = readCriticIfExists(specDir, intentId, profile);
  let specDigest: GateContext["artifacts"]["specDigest"];
  if (verification) {
    const specContent = readSpecMdIfExists(specDir, intentId) ?? "";
    specDigest = {
      spec: computeDigest(specContent),
      verification: computeDigest(canonicalVerificationContent(verification)),
    };
  }
  return {
    trigger,
    state,
    profile,
    artifacts: { intent, critic, verification: verification ?? undefined, specDigest },
  };
}

/** Builds the GateContext for `trigger` and evaluates DEFAULT_GATES against it in one call. */
export function evaluateGatesForTrigger(
  specDir: string,
  intentId: string,
  state: LaneState,
  intent: Intent,
  profile: Profile,
  trigger: GateTrigger,
): GateEvaluation {
  return evaluateGates(
    DEFAULT_GATES,
    buildGateContext(specDir, intentId, state, intent, profile, trigger),
  );
}

/**
 * CLI-facing formatting: errors and warnings each prefixed with their gate id, so a
 * message like "[success_criteria] ..." is traceable to the gate that raised it without
 * needing to inspect the Diagnostic objects directly. Takes a plain diagnostics array
 * (rather than a whole GateEvaluation) since validate.ts merges diagnostics from more than
 * one evaluateGatesForTrigger() call before formatting.
 */
export function formatDiagnostics(diagnostics: readonly Diagnostic[]): {
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const d of diagnostics) {
    const line = `[${d.gateId}] ${d.message}`;
    (d.severity === "error" ? errors : warnings).push(line);
  }
  return { errors, warnings };
}
