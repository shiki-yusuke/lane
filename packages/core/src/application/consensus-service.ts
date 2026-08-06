import type { SpecConsensus, Verification } from "@lane/schemas";
import { computeDigest } from "../digest.js";

export { computeDigest };

// design.md §2.4/§3.3/§5.3 — spec_consensus's digest binding needs one canonical way to
// hash spec.md/verification.yaml content; both the CLI (when writing an ack) and
// core/gate.ts's specConsensusGate (when re-checking at gate time) must use the exact
// same function or a legitimate edit could look like a digest mismatch (or vice versa).

/**
 * Canonical string hashed for verification_digest: every Verification field *except*
 * spec_consensus itself. spec_consensus's own spec_digest/verification_digest/
 * reviewer_ack fields reference the digest being computed, so hashing the whole file
 * (spec_consensus included) would be self-referential — re-hashing an unchanged file
 * would never reproduce the digest that was written into it. Field order is fixed
 * explicitly (not "whatever order the object was built in") so the digest is stable
 * regardless of how the caller assembled the Verification object.
 *
 * Gate-port review (2026-08-06, P0): success_criteria_matrix/cross_check_intent_vs_spec
 * are included here too — without this, editing the matrix after a reviewer_ack was
 * recorded would leave the ack looking valid (digest unchanged) even though the actual
 * coverage claims it's vouching for had changed underneath it, defeating the entire point
 * of binding the ack to content by hash.
 */
export function canonicalVerificationContent(verification: Verification): string {
  return JSON.stringify({
    schema_version: verification.schema_version,
    intent_id: verification.intent_id,
    target_pr: verification.target_pr ?? null,
    test_matrix: verification.test_matrix,
    test_gaps: verification.test_gaps,
    manual_verification: verification.manual_verification,
    goal_stopping_condition: verification.goal_stopping_condition,
    success_criteria_matrix: verification.success_criteria_matrix ?? null,
    cross_check_intent_vs_spec: verification.cross_check_intent_vs_spec ?? null,
  });
}

export interface SpecConsensusInputs {
  specSsotRef: string;
  specContent: string;
  verificationContent: string;
}

/**
 * Recomputes spec_digest/verification_digest from current file content. If an existing
 * reviewer_ack no longer matches (content changed since it was recorded), it is dropped —
 * an ack must never silently keep pointing at stale content once this function has been
 * called with fresh input.
 */
export function refreshSpecConsensusDigests(
  existing: SpecConsensus | undefined,
  inputs: SpecConsensusInputs,
): SpecConsensus {
  const specDigest = computeDigest(inputs.specContent);
  const verificationDigest = computeDigest(inputs.verificationContent);
  const ackStillValid =
    !!existing?.reviewer_ack &&
    existing.reviewer_ack.spec_sha256 === specDigest &&
    existing.reviewer_ack.verification_sha256 === verificationDigest;
  return {
    spec_ssot_ref: inputs.specSsotRef,
    spec_digest: specDigest,
    verification_digest: verificationDigest,
    deviations: existing?.deviations ?? [],
    reviewer_ack: ackStillValid ? (existing?.reviewer_ack ?? null) : null,
  };
}
