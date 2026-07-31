import {
  DEFAULT_GATES,
  type GateContext,
  type GateResult,
  canonicalVerificationContent,
  computeDigest,
  evaluateGates,
} from "@lane/core";
import type { Intent, LaneState, Phase, Profile } from "@lane/schemas";
import { readSpecMdIfExists } from "./spec-store.js";
import { readVerificationIfExists } from "./verification-store.js";

/**
 * Shared by validate.ts and advance.ts's 4_verify -> 5_done branch (design.md §3.3:
 * spec_consensus is evaluated at both `before_pr_publish` and 4_verify->5_done). Reads
 * spec.md/verification.yaml fresh from disk and computes their digests right here, so the
 * gate always checks the *current* on-disk content against whatever digest is recorded in
 * verification.yaml's spec_consensus — not a value someone forgot to refresh.
 *
 * Before Codex M1 review: advance's 5_done transition called createDoneOverlay directly,
 * with no gate check at all (must-1), and validate never populated specDigest, so a
 * content change after ack could never be detected (must-2). Both are fixed by always
 * routing through this one function.
 */
export function evaluateBeforePrPublishGates(
  specDir: string,
  intentId: string,
  state: LaneState,
  intent: Intent,
  profile: Profile,
  targetPhase: Phase,
): GateResult {
  const verification = readVerificationIfExists(specDir, intentId);
  let specDigest: GateContext["artifacts"]["specDigest"];
  if (verification) {
    const specContent = readSpecMdIfExists(specDir, intentId) ?? "";
    specDigest = {
      spec: computeDigest(specContent),
      verification: computeDigest(canonicalVerificationContent(verification)),
    };
  }
  const ctx: GateContext = {
    phase: state.current_phase,
    targetPhase,
    event: "before_pr_publish",
    state,
    profile,
    artifacts: { intent, verification: verification ?? undefined, specDigest },
  };
  return evaluateGates(DEFAULT_GATES, ctx);
}
