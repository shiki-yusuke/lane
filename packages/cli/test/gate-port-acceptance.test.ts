import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { runAdvance } from "../src/commands/advance.js";
import { runStart } from "../src/commands/start.js";
import { readIntent, writeIntent } from "../src/intent-store.js";
import { laneStatePath, readLaneState } from "../src/state-store.js";

// Gate-port review (2026-08-06), item 6, required acceptance tests 1/2. These exercise
// runAdvance directly (no subprocess) so they run fast in the normal test suite;
// test/e2e.test.ts covers the same two gates through the packed CLI binary (required
// acceptance test 5). Required acceptance test 4 (matrix change invalidates ack) lives in
// consensus.test.ts, next to the rest of the spec_consensus digest-binding tests it
// extends. Required acceptance test 3 (appliesTo matrix across every transition edge)
// lives in packages/core/test/gate-applies-to-matrix.test.ts, since it's about the gates
// themselves, not CLI wiring.

describe("gate-port acceptance: failed advance leaves lane-state.json byte-for-byte unchanged", () => {
  let specDir: string;
  const intentId = "I-2026-08-06-acceptance-1";

  beforeEach(() => {
    specDir = mkdtempSync(join(tmpdir(), "lane-gate-acceptance-"));
    runStart(intentId, { specDir });
  });

  it("premise_evidence required:true + reproduced:false blocks 1_intent -> 2_spec and touches nothing on disk", () => {
    const intent = readIntent(specDir, intentId);
    writeIntent(specDir, intentId, {
      ...intent,
      premise_evidence: {
        required: true,
        method: "live",
        reproduced: false,
        evidence: "Attempted to reproduce locally but could not observe the reported behavior.",
      },
    });

    const effectiveRiskLogLengthBefore = readLaneState(specDir, intentId).effective_risk_log.length;
    const before = readFileSync(laneStatePath(specDir, intentId), "utf-8");
    const result = runAdvance(intentId, "2_spec", { specDir });
    const after = readFileSync(laneStatePath(specDir, intentId), "utf-8");
    const effectiveRiskLogLengthAfter = readLaneState(specDir, intentId).effective_risk_log.length;

    expect(result.exitCode).toBe(3);
    expect(result.message).toContain("[premise_evidence]");
    expect(after).toBe(before); // byte-for-byte
    // Explicit on top of the byte comparison above (team-lead review, 2026-08-06): a
    // gate-blocked advance must not even append an effective-risk audit entry -- design.md
    // §3.9's documented intent is that a failed advance attempt leaves *zero* trace in
    // lane-state, not "everything except the phase/status fields."
    expect(effectiveRiskLogLengthAfter).toBe(effectiveRiskLogLengthBefore);
    expect(effectiveRiskLogLengthBefore).toBe(0); // sanity: this lane never had a gate evaluated yet
  });
});

describe("gate-port acceptance: an advance with only warnings still succeeds, and the warning is in the output", () => {
  let specDir: string;
  const intentId = "I-2026-08-06-acceptance-2";

  beforeEach(() => {
    specDir = mkdtempSync(join(tmpdir(), "lane-gate-acceptance-"));
    runStart(intentId, { specDir });
  });

  it("advancing 1_intent -> 2_spec with premise_evidence entirely unrecorded succeeds with the warning surfaced", () => {
    // Never touches intent.premise_evidence at all -- this is the "unrecorded" case,
    // which the gate treats as a warning (it cannot itself decide whether this change
    // needed the check), never an error.
    const result = runAdvance(intentId, "2_spec", { specDir });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("Advanced");
    expect(result.message).toContain("[premise_evidence]");
    expect(result.message.toLowerCase()).toContain("premise_evidence is not recorded");
  });
});
