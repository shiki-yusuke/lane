import {
  canonicalVerificationContent,
  computeDigest,
  refreshSpecConsensusDigests,
} from "@lane/core";
import type { Deviation, SpecConsensus, Verification } from "@lane/schemas";
import { readIntent } from "../intent-store.js";
import { resolveSpecDir } from "../spec-dir.js";
import { readSpecMdIfExists } from "../spec-store.js";
import { laneStateExists, readLaneState } from "../state-store.js";
import { readVerificationIfExists, writeVerification } from "../verification-store.js";
import type { CommandResult } from "./start.js";

export interface ConsensusOptions {
  specDir?: string;
  /** Required the first time spec_consensus is initialized (with --refresh). */
  specSsotRef?: string;
  /** Recomputes spec_digest/verification_digest from the current spec.md/verification.yaml. */
  refresh?: boolean;
  addDeviation?: {
    specRef: string;
    actual: string;
    action: "accept" | "fix" | "update_spec";
    evidenceRef?: string;
  };
  resolveDeviation?: { specRef: string; rationale: string };
  ack?: {
    reviewerKind: "self" | "independent_agent" | "human";
    reviewerId: string;
    overrideReason?: string;
    evidenceRef?: string;
    note?: string;
  };
  /** Read-only: prints a "Spec Deviations" PR body section to stdout. Never writes anything. */
  emitPrSection?: boolean;
}

/**
 * `lane consensus <intent-id>` — design.md §2.4/§3.3/§5.3's spec_consensus is a hard gate
 * (core/gate.ts's specConsensusGate), but writing valid spec_consensus content by hand-
 * editing verification.yaml is error-prone (digest computation, refine invariants). This
 * command is the file-edit-and-validate support surface the gate needs, deliberately not
 * an interactive wizard: every mutation is one flag combination, so it composes in scripts
 * and CI the same way the rest of this CLI does.
 *
 * `--emit-pr-section` only ever writes to stdout — annotatePr's in-place PR body editing
 * stays out of v1 scope (design.md §5.3/§8); a caller wires the output into their own PR
 * creation step.
 */
export function runConsensus(intentId: string, opts: ConsensusOptions): CommandResult {
  const specDir = resolveSpecDir({ override: opts.specDir });
  if (!laneStateExists(specDir, intentId)) {
    return { exitCode: 2, message: `Lane state not found: ${intentId}` };
  }

  const verification = readVerificationIfExists(specDir, intentId);
  if (!verification) {
    return {
      exitCode: 2,
      message: `verification.yaml not found for ${intentId} (write it before running lane consensus)`,
    };
  }

  if (opts.emitPrSection) {
    return emitPrSection(verification);
  }

  let consensus: SpecConsensus | undefined = verification.spec_consensus;

  if (opts.refresh) {
    const specSsotRef = opts.specSsotRef ?? consensus?.spec_ssot_ref;
    if (!specSsotRef) {
      return {
        exitCode: 1,
        message: "--spec-ssot-ref is required the first time spec_consensus is initialized",
      };
    }
    const specContent = readSpecMdIfExists(specDir, intentId) ?? "";
    consensus = refreshSpecConsensusDigests(consensus, {
      specSsotRef,
      specContent,
      verificationContent: canonicalVerificationContent(verification),
    });
  }
  if (!consensus) {
    return {
      exitCode: 1,
      message: "spec_consensus is not initialized yet — run with --refresh first",
    };
  }

  if (opts.addDeviation) {
    const { specRef, actual, action, evidenceRef } = opts.addDeviation;
    // should-6 (Codex M3 review): reject decisively here, at the CLI boundary, rather than
    // falling through to a less legible zod/write-time failure deep inside Deviation
    // construction below.
    if (!specRef || !actual || !action) {
      return {
        exitCode: 1,
        message: "--add-deviation requires --spec-ref, --actual, and --action all to be set",
      };
    }
    if (!["accept", "fix", "update_spec"].includes(action)) {
      return {
        exitCode: 1,
        message: `--action must be one of accept|fix|update_spec (got: ${action})`,
      };
    }
    if (consensus.deviations.some((d) => d.spec_ref === specRef)) {
      return {
        exitCode: 1,
        message: `a deviation for spec_ref "${specRef}" already exists (use --resolve-deviation, or edit verification.yaml directly for anything else)`,
      };
    }
    const deviation: Deviation = {
      spec_ref: specRef,
      actual,
      action,
      status: "pending",
      evidence_ref: evidenceRef,
    };
    consensus = { ...consensus, deviations: [...consensus.deviations, deviation] };
  }

  if (opts.resolveDeviation) {
    const { specRef, rationale } = opts.resolveDeviation;
    if (!specRef || !rationale) {
      return {
        exitCode: 1,
        message: "--resolve-deviation requires both a spec_ref value and --rationale",
      };
    }
    const idx = consensus.deviations.findIndex((d) => d.spec_ref === specRef);
    if (idx === -1) {
      return { exitCode: 1, message: `no deviation found for spec_ref "${specRef}"` };
    }
    const updated = [...consensus.deviations];
    const existing = updated[idx];
    if (!existing) {
      return { exitCode: 1, message: `no deviation found for spec_ref "${specRef}"` };
    }
    updated[idx] = { ...existing, status: "resolved", rationale };
    consensus = { ...consensus, deviations: updated };
  }

  if (opts.ack) {
    if (!opts.ack.reviewerKind || !opts.ack.reviewerId) {
      return {
        exitCode: 1,
        message: "--ack requires both --reviewer-kind and --reviewer-id to be set",
      };
    }
    if (!["self", "independent_agent", "human"].includes(opts.ack.reviewerKind)) {
      return {
        exitCode: 1,
        message: `--reviewer-kind must be one of self|independent_agent|human (got: ${opts.ack.reviewerKind})`,
      };
    }
    const pending = consensus.deviations.filter((d) => d.status === "pending");
    if (pending.length > 0) {
      return {
        exitCode: 1,
        message: `cannot ack: ${pending.length} unresolved deviation(s) remain (resolve them first)`,
      };
    }
    // must-3 (Codex M3 review): the old code stamped `consensus.spec_digest` /
    // `consensus.verification_digest` — the values *stored* from the last --refresh — onto
    // the new ack without ever checking whether spec.md/verification.yaml changed since
    // then. Re-verify against fresh disk content here with the exact same
    // computeDigest()/canonicalVerificationContent() calls the gate itself uses
    // (gate-check.ts's evaluateGatesForTrigger), so a content edit made between
    // --refresh and --ack is caught here instead of only surfacing later as a confusing
    // gate failure.
    const freshSpecDigest = computeDigest(readSpecMdIfExists(specDir, intentId) ?? "");
    const freshVerificationDigest = computeDigest(canonicalVerificationContent(verification));
    if (
      freshSpecDigest !== consensus.spec_digest ||
      freshVerificationDigest !== consensus.verification_digest
    ) {
      return {
        exitCode: 1,
        message: "content changed since last --refresh; run --refresh and re-review",
      };
    }
    const intent = readIntent(specDir, intentId);
    const state = readLaneState(specDir, intentId);
    const effectiveRisk =
      state.effective_risk_log.at(-1)?.effective_risk ?? intent.intent.declared_risk;
    if (opts.ack.reviewerKind === "self" && effectiveRisk === "high" && !opts.ack.overrideReason) {
      return {
        exitCode: 1,
        message: "effective risk=high requires --override-reason for a self ack (audited override)",
      };
    }
    consensus = {
      ...consensus,
      reviewer_ack: {
        reviewer_kind: opts.ack.reviewerKind,
        reviewer_id: opts.ack.reviewerId,
        acked_at: new Date().toISOString(),
        spec_sha256: consensus.spec_digest,
        verification_sha256: consensus.verification_digest,
        evidence_ref: opts.ack.evidenceRef,
        note: opts.ack.note,
        override_reason: opts.ack.overrideReason,
      },
    };
  }

  writeVerification(specDir, intentId, { ...verification, spec_consensus: consensus });
  return { exitCode: 0, message: formatConsensusStatus(consensus) };
}

function formatConsensusStatus(consensus: SpecConsensus): string {
  const pending = consensus.deviations.filter((d) => d.status === "pending").length;
  const resolved = consensus.deviations.length - pending;
  const lines = [
    `spec_ssot_ref: ${consensus.spec_ssot_ref}`,
    `spec_digest: ${consensus.spec_digest.slice(0, 16)}...`,
    `verification_digest: ${consensus.verification_digest.slice(0, 16)}...`,
    `deviations: ${consensus.deviations.length} total (${pending} pending, ${resolved} resolved)`,
    consensus.reviewer_ack
      ? `reviewer_ack: ${consensus.reviewer_ack.reviewer_kind} (${consensus.reviewer_ack.reviewer_id}) at ${consensus.reviewer_ack.acked_at}`
      : "reviewer_ack: (none)",
  ];
  return lines.join("\n");
}

function emitPrSection(verification: Verification): CommandResult {
  const consensus = verification.spec_consensus;
  if (!consensus) {
    return {
      exitCode: 1,
      message: "spec_consensus is not initialized yet — run with --refresh first",
    };
  }
  const lines = ["## Spec Deviations", ""];
  if (consensus.deviations.length === 0) {
    lines.push("No deviations.");
  } else {
    for (const d of consensus.deviations) {
      lines.push(`- **${d.spec_ref}** (${d.action}/${d.status}): ${d.actual}`);
      if (d.rationale) lines.push(`  - rationale: ${d.rationale}`);
      if (d.evidence_ref) lines.push(`  - evidence: ${d.evidence_ref}`);
    }
  }
  if (consensus.reviewer_ack) {
    lines.push(
      "",
      `Reviewed by: ${consensus.reviewer_ack.reviewer_kind} (${consensus.reviewer_ack.reviewer_id}) at ${consensus.reviewer_ack.acked_at}`,
    );
  }
  return { exitCode: 0, message: lines.join("\n") };
}
