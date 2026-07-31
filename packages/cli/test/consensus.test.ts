import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Verification } from "@lane/schemas";
import { beforeEach, describe, expect, it } from "vitest";
import { runConsensus } from "../src/commands/consensus.js";
import { runStart } from "../src/commands/start.js";
import { writeSpecMd } from "../src/spec-store.js";
import { readVerificationIfExists, writeVerification } from "../src/verification-store.js";

function baseVerification(intentId: string): Verification {
  return {
    schema_version: "1.0",
    intent_id: intentId,
    test_matrix: [{ ears_rule: "Rule 1", test_type: "unit", status: "existing" }],
    test_gaps: [],
    manual_verification: [],
    goal_stopping_condition: [],
  };
}

describe("runConsensus", () => {
  let specDir: string;
  const intentId = "I-2026-07-31-consensus-flow";

  beforeEach(() => {
    specDir = mkdtempSync(join(tmpdir(), "lane-consensus-spec-"));
    runStart(intentId, { specDir });
    writeSpecMd(specDir, intentId, "# Spec\n\nRule 1: something.\n");
    writeVerification(specDir, intentId, baseVerification(intentId));
  });

  it("fails cleanly when verification.yaml doesn't exist", () => {
    const otherIntentId = "I-2026-07-31-consensus-no-verification";
    runStart(otherIntentId, { specDir });
    const result = runConsensus(otherIntentId, { specDir });
    expect(result.exitCode).toBe(2);
  });

  it("requires --spec-ssot-ref the first time --refresh initializes spec_consensus", () => {
    const result = runConsensus(intentId, { specDir, refresh: true });
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("--spec-ssot-ref");
  });

  it("--refresh initializes spec_consensus with computed digests and no ack", () => {
    const result = runConsensus(intentId, {
      specDir,
      refresh: true,
      specSsotRef: "docs/spec-impact/specs/example.md",
    });
    expect(result.exitCode).toBe(0);
    const verification = readVerificationIfExists(specDir, intentId);
    expect(verification?.spec_consensus?.spec_ssot_ref).toBe("docs/spec-impact/specs/example.md");
    expect(verification?.spec_consensus?.spec_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(verification?.spec_consensus?.deviations).toEqual([]);
    expect(verification?.spec_consensus?.reviewer_ack).toBeNull();
  });

  it("rejects ack/add-deviation/emit-pr-section before spec_consensus is initialized", () => {
    expect(
      runConsensus(intentId, { specDir, ack: { reviewerKind: "self", reviewerId: "me" } }).exitCode,
    ).toBe(1);
    expect(runConsensus(intentId, { specDir, emitPrSection: true }).exitCode).toBe(1);
  });

  it("full flow: add-deviation (pending) -> ack blocked -> resolve -> ack succeeds", () => {
    runConsensus(intentId, {
      specDir,
      refresh: true,
      specSsotRef: "docs/spec-impact/specs/example.md",
    });

    const added = runConsensus(intentId, {
      specDir,
      addDeviation: {
        specRef: "Rule 1",
        actual: "implemented slightly differently",
        action: "accept",
      },
    });
    expect(added.exitCode).toBe(0);
    expect(readVerificationIfExists(specDir, intentId)?.spec_consensus?.deviations).toHaveLength(1);

    const blockedAck = runConsensus(intentId, {
      specDir,
      ack: { reviewerKind: "human", reviewerId: "reviewer-1" },
    });
    expect(blockedAck.exitCode).toBe(1);
    expect(blockedAck.message).toContain("unresolved deviation");

    const resolved = runConsensus(intentId, {
      specDir,
      resolveDeviation: { specRef: "Rule 1", rationale: "Confirmed acceptable in review." },
    });
    expect(resolved.exitCode).toBe(0);
    const afterResolve = readVerificationIfExists(specDir, intentId)?.spec_consensus?.deviations[0];
    expect(afterResolve?.status).toBe("resolved");
    expect(afterResolve?.rationale).toBe("Confirmed acceptable in review.");

    const acked = runConsensus(intentId, {
      specDir,
      ack: { reviewerKind: "human", reviewerId: "reviewer-1" },
    });
    expect(acked.exitCode).toBe(0);
    const consensus = readVerificationIfExists(specDir, intentId)?.spec_consensus;
    expect(consensus?.reviewer_ack?.reviewer_kind).toBe("human");
    expect(consensus?.reviewer_ack?.spec_sha256).toBe(consensus?.spec_digest);
  });

  it("should-6: rejects --add-deviation missing a required accompanying flag", () => {
    runConsensus(intentId, { specDir, refresh: true, specSsotRef: "x" });
    const result = runConsensus(intentId, {
      specDir,
      addDeviation: { specRef: "Rule 1", actual: "", action: "accept" },
    });
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("--add-deviation requires");
  });

  it("should-6: rejects --add-deviation with an invalid --action value", () => {
    runConsensus(intentId, { specDir, refresh: true, specSsotRef: "x" });
    const result = runConsensus(intentId, {
      specDir,
      // biome-ignore lint/suspicious/noExplicitAny: deliberately passing an invalid action to exercise the CLI-side validation
      addDeviation: { specRef: "Rule 1", actual: "x", action: "bogus" as any },
    });
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("--action must be one of");
  });

  it("should-6: rejects --resolve-deviation without --rationale", () => {
    runConsensus(intentId, { specDir, refresh: true, specSsotRef: "x" });
    runConsensus(intentId, {
      specDir,
      addDeviation: { specRef: "Rule 1", actual: "x", action: "accept" },
    });
    const result = runConsensus(intentId, {
      specDir,
      resolveDeviation: { specRef: "Rule 1", rationale: "" },
    });
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("--resolve-deviation requires");
  });

  it("should-6: rejects --ack missing --reviewer-id", () => {
    runConsensus(intentId, { specDir, refresh: true, specSsotRef: "x" });
    const result = runConsensus(intentId, {
      specDir,
      ack: { reviewerKind: "human", reviewerId: "" },
    });
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("--ack requires");
  });

  it("should-6: rejects --ack with an invalid --reviewer-kind value", () => {
    runConsensus(intentId, { specDir, refresh: true, specSsotRef: "x" });
    const result = runConsensus(intentId, {
      specDir,
      // biome-ignore lint/suspicious/noExplicitAny: deliberately passing an invalid reviewerKind to exercise the CLI-side validation
      ack: { reviewerKind: "bogus" as any, reviewerId: "r1" },
    });
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("--reviewer-kind must be one of");
  });

  it("rejects adding a second deviation for the same spec_ref", () => {
    runConsensus(intentId, { specDir, refresh: true, specSsotRef: "x" });
    runConsensus(intentId, {
      specDir,
      addDeviation: { specRef: "Rule 1", actual: "a", action: "accept" },
    });
    const second = runConsensus(intentId, {
      specDir,
      addDeviation: { specRef: "Rule 1", actual: "b", action: "fix" },
    });
    expect(second.exitCode).toBe(1);
    expect(second.message).toContain("already exists");
  });

  it("rejects resolving a deviation that doesn't exist", () => {
    runConsensus(intentId, { specDir, refresh: true, specSsotRef: "x" });
    const result = runConsensus(intentId, {
      specDir,
      resolveDeviation: { specRef: "nonexistent", rationale: "x" },
    });
    expect(result.exitCode).toBe(1);
  });

  it("requires --override-reason for a self ack when effective risk is high", () => {
    const highRiskIntentId = "I-2026-07-31-consensus-high-risk";
    runStart(highRiskIntentId, { specDir, risk: "high" });
    writeSpecMd(specDir, highRiskIntentId, "# Spec\n");
    writeVerification(specDir, highRiskIntentId, baseVerification(highRiskIntentId));
    runConsensus(highRiskIntentId, { specDir, refresh: true, specSsotRef: "x" });

    const withoutOverride = runConsensus(highRiskIntentId, {
      specDir,
      ack: { reviewerKind: "self", reviewerId: "me" },
    });
    expect(withoutOverride.exitCode).toBe(1);
    expect(withoutOverride.message).toContain("override-reason");

    const withOverride = runConsensus(highRiskIntentId, {
      specDir,
      ack: {
        reviewerKind: "self",
        reviewerId: "me",
        overrideReason: "solo dev, no reviewer available",
      },
    });
    expect(withOverride.exitCode).toBe(0);
  });

  it("must-3: --ack rejects when spec.md was edited after --refresh but before --ack (without an intervening --refresh)", () => {
    runConsensus(intentId, { specDir, refresh: true, specSsotRef: "x" });

    writeSpecMd(specDir, intentId, "# Spec\n\nRule 1: something edited after refresh.\n");

    const result = runConsensus(intentId, {
      specDir,
      ack: { reviewerKind: "human", reviewerId: "r1" },
    });
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("content changed since last --refresh");
    expect(readVerificationIfExists(specDir, intentId)?.spec_consensus?.reviewer_ack).toBeNull();
  });

  it("re-running --refresh after spec.md content changes drops a previously recorded ack", () => {
    runConsensus(intentId, { specDir, refresh: true, specSsotRef: "x" });
    runConsensus(intentId, { specDir, ack: { reviewerKind: "human", reviewerId: "r1" } });
    expect(
      readVerificationIfExists(specDir, intentId)?.spec_consensus?.reviewer_ack,
    ).not.toBeNull();

    writeSpecMd(specDir, intentId, "# Spec\n\nRule 1: something different now.\n");
    runConsensus(intentId, { specDir, refresh: true });
    expect(readVerificationIfExists(specDir, intentId)?.spec_consensus?.reviewer_ack).toBeNull();
  });

  it("--emit-pr-section prints deviations and ack status without writing anything", () => {
    runConsensus(intentId, { specDir, refresh: true, specSsotRef: "x" });
    runConsensus(intentId, {
      specDir,
      addDeviation: { specRef: "Rule 1", actual: "slightly different", action: "accept" },
    });
    runConsensus(intentId, {
      specDir,
      resolveDeviation: { specRef: "Rule 1", rationale: "fine" },
    });
    runConsensus(intentId, { specDir, ack: { reviewerKind: "human", reviewerId: "r1" } });

    const before = readVerificationIfExists(specDir, intentId);
    const result = runConsensus(intentId, { specDir, emitPrSection: true });
    const after = readVerificationIfExists(specDir, intentId);

    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("## Spec Deviations");
    expect(result.message).toContain("Rule 1");
    expect(result.message).toContain("Reviewed by: human");
    expect(after).toEqual(before); // read-only: nothing was written
  });

  it("--emit-pr-section reports no differences when there are no deviations", () => {
    runConsensus(intentId, { specDir, refresh: true, specSsotRef: "x" });
    const result = runConsensus(intentId, { specDir, emitPrSection: true });
    expect(result.message).toContain("No deviations");
  });
});
