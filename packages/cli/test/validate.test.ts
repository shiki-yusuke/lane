import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAdvance } from "../src/commands/advance.js";
import { runStart } from "../src/commands/start.js";
import { runValidate } from "../src/commands/validate.js";
import { criticPath } from "../src/critic-store.js";

// Codex M4 review, must-2: critic.yaml had no CLI-side schema check at all before this --
// a malformed one could sail past every gate undetected. lane validate now checks it
// whenever it exists, but never requires it (matching intent.yaml/verification.yaml's own
// "read-if-exists, never mandatory before it's written" convention).
describe("runValidate (critic.yaml)", () => {
  let specDir: string;
  const intentId = "I-2026-07-31-validate-critic";

  beforeEach(() => {
    specDir = mkdtempSync(join(tmpdir(), "lane-validate-critic-"));
    runStart(intentId, { specDir });
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: process.env.X = undefined coerces to the string "undefined", not real deletion
    delete process.env.LANE_DATA_DIR;
  });

  it("passes when critic.yaml doesn't exist yet", () => {
    const result = runValidate(intentId, { specDir });
    expect(result.exitCode).toBe(0);
    expect(result.message).not.toContain("critic.yaml");
  });

  it("passes and mentions critic.yaml when a valid one exists", () => {
    writeFileSync(
      criticPath(specDir, intentId),
      [
        'schema_version: "1.0"',
        `intent_id: ${intentId}`,
        "decision: pass",
        "confidence: high",
        "per_lens:",
        "  - lens_id: lifecycle_management",
        "    result: not_applicable",
        "  - lens_id: error_handling",
        "    result: not_applicable",
        "  - lens_id: security",
        "    result: not_applicable",
        "  - lens_id: performance",
        "    result: not_applicable",
        "  - lens_id: a11y",
        "    result: not_applicable",
        "  - lens_id: i18n",
        "    result: not_applicable",
        "  - lens_id: architecture",
        "    result: not_applicable",
        "  - lens_id: test_coverage",
        "    result: unknown",
        "    open_question: No test exists yet.",
        "  - lens_id: documentation",
        "    result: not_applicable",
      ].join("\n"),
    );
    const result = runValidate(intentId, { specDir });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("critic.yaml is valid");
  });

  it("throws when critic.yaml has an applicable lens missing finding/taxonomy", () => {
    writeFileSync(
      criticPath(specDir, intentId),
      [
        'schema_version: "1.0"',
        `intent_id: ${intentId}`,
        "decision: pass",
        "confidence: high",
        "per_lens:",
        "  - lens_id: security",
        "    result: applicable", // missing finding + taxonomy, required per the schema refine
      ].join("\n"),
    );
    expect(() => runValidate(intentId, { specDir })).toThrow();
  });

  it("throws when critic.yaml uses an unrecognized lens_id", () => {
    writeFileSync(
      criticPath(specDir, intentId),
      [
        'schema_version: "1.0"',
        `intent_id: ${intentId}`,
        "decision: pass",
        "confidence: high",
        "per_lens:",
        "  - lens_id: not_a_real_lens",
        "    result: not_applicable",
      ].join("\n"),
    );
    expect(() => runValidate(intentId, { specDir })).toThrow();
  });

  it("throws when critic.yaml puts `decision` on a per-lens entry instead of at the top level (the old, wrong shape)", () => {
    writeFileSync(
      criticPath(specDir, intentId),
      [
        'schema_version: "1.0"',
        `intent_id: ${intentId}`,
        "decision: pass",
        "confidence: high",
        "per_lens:",
        "  - lens_id: security",
        "    decision: pass", // wrong: per-lens has `result`, not `decision`
      ].join("\n"),
    );
    expect(() => runValidate(intentId, { specDir })).toThrow();
  });
});

// Codex review (2026-08-06, should): at 3_implement, `lane validate` evaluates
// successCriteriaGate through *two* triggers (phase_advance{3_implement->4_verify} and
// before_pr_publish{phase:3_implement}) -- both apply, so without dedupe the exact same
// finding would appear twice in the output.
describe("runValidate diagnostic dedupe", () => {
  let specDir: string;
  const intentId = "I-2026-08-06-validate-dedupe";

  beforeEach(() => {
    specDir = mkdtempSync(join(tmpdir(), "lane-validate-dedupe-"));
    runStart(intentId, { specDir });
    expect(runAdvance(intentId, "2_spec", { specDir }).exitCode).toBe(0);
    expect(runAdvance(intentId, "3_implement", { specDir }).exitCode).toBe(0);
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: process.env.X = undefined coerces to the string "undefined", not real deletion
    delete process.env.LANE_DATA_DIR;
  });

  it("reports the success_criteria matrix-missing warning exactly once at 3_implement, not twice", () => {
    const result = runValidate(intentId, { specDir });
    expect(result.exitCode).toBe(0);
    const occurrences = result.message.split("success_criteria_matrix is not recorded").length - 1;
    expect(occurrences).toBe(1);
  });
});
