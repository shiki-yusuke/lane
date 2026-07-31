import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listObservations } from "../src/calibration-store.js";
import { runCalibrate } from "../src/commands/calibrate.js";
import { runEstimate } from "../src/commands/estimate.js";
import { runStart } from "../src/commands/start.js";
import { readIntent, writeIntent } from "../src/intent-store.js";

// Real integration test against the actual agent-cost binary — same convention as
// packages/adapters/test/telemetry-agent-cost.test.ts (and the same "not on PATH yet"
// caveat: agent-cost isn't published anywhere pip can install it from yet, only from an
// editable local checkout). Skipped entirely if agent-cost can't be resolved via PATH or
// LANE_TEST_AGENT_COST_BIN (point that env var at your own local install to run these).
function resolveAgentCostBin(): string | null {
  if (process.env.LANE_TEST_AGENT_COST_BIN) return process.env.LANE_TEST_AGENT_COST_BIN;
  try {
    execFileSync("agent-cost", ["--version"], { stdio: "ignore" });
    return "agent-cost";
  } catch {
    // not on PATH
  }
  return null;
}

const bin = resolveAgentCostBin();
const describeOrSkip = bin ? describe : describe.skip;

// A narrow, arbitrary historical window. Bounding with --since/--until didn't reliably cut
// scan time on this dev machine on repeated measurement (unlike the single fast run
// telemetry-agent-cost.test.ts happened to observe) — agent-cost's own read cost seems to
// dominate regardless. Kept anyway to exercise the --since/--until plumbing (real usage
// always bounds this to a phase's actual window); test timeouts below are sized for the
// slow case, not for an assumed speedup.
const FAST_WINDOW = { since: "2020-01-01T00:00:00Z", until: "2020-01-02T00:00:00Z" };

describeOrSkip("runCalibrate (real agent-cost subprocess)", () => {
  let specDir: string;
  let dataDir: string;
  const intentId = "I-2026-07-31-calibrate-flow";

  beforeEach(() => {
    specDir = mkdtempSync(join(tmpdir(), "lane-calibrate-spec-"));
    dataDir = mkdtempSync(join(tmpdir(), "lane-calibrate-data-"));
    process.env.LANE_DATA_DIR = dataDir;
    runStart(intentId, { specDir });
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: process.env.X = undefined coerces to the string "undefined", not real deletion
    delete process.env.LANE_DATA_DIR;
  });

  it("requires at least one --session-id", async () => {
    const result = await runCalibrate(intentId, {
      specDir,
      sessionIds: [],
      agentCostBin: bin ?? undefined,
    });
    expect(result.exitCode).toBe(1);
  });

  it("records a CalibrationObservation for a session id with no matched usage, and no prediction_evaluation without a baseline", async () => {
    const result = await runCalibrate(intentId, {
      specDir,
      sessionIds: ["lane-test-nonexistent-session-id"],
      agentCostBin: bin ?? undefined,
      ...FAST_WINDOW,
    });
    expect(result.exitCode, result.message).toBe(0);
    expect(result.message).toContain("tokens=0");
    expect(result.message).toContain("no baseline_estimate_revision_id");

    const observations = listObservations();
    expect(observations).toHaveLength(1);
    expect(observations[0]?.intent_id).toBe(intentId);
    // must-1 (M2 review, 2026-07-31): with no baseline adopted, predictors fall back to a
    // freshly-built (necessarily impact-scan-less) set, and predictor_quality must say so
    // explicitly rather than implying "observed" the way the old hardcoded value did.
    expect(observations[0]?.predictors.files_touched_estimate).toBeNull();
    expect(observations[0]?.predictor_quality).toBe("imputed");
    // agent-cost's own scan cost dominates regardless of --since/--until bounding on this
    // dev machine (observed ~20-25s either way) — headroom over that, not over a "fast
    // bounded scan" assumption that didn't hold up under repeated measurement.
  }, 45_000);

  it("must-1: when a baseline with a real impact-scan snapshot is adopted, its predictors (not nulled-out ones) carry over into the observation", async () => {
    const impactScanPath = join(specDir, "impact-scan-report.md");
    writeFileSync(
      impactScanPath,
      [
        "# Impact Scan",
        "```impact-scan:v1",
        JSON.stringify({
          scan_version: "1.0",
          repo_commit: "abc1234",
          candidate_paths: ["src/a.ts", "src/b.ts", "src/c.ts"],
          candidate_layers: ["ui", "domain"],
        }),
        "```",
      ].join("\n"),
    );
    runEstimate(intentId, { specDir, impactScanFile: impactScanPath, adopt: true });

    const result = await runCalibrate(intentId, {
      specDir,
      sessionIds: ["lane-test-nonexistent-session-id"],
      agentCostBin: bin ?? undefined,
      ...FAST_WINDOW,
    });
    expect(result.exitCode, result.message).toBe(0);

    const observations = listObservations();
    expect(observations).toHaveLength(1);
    // the values captured in the adopted baseline's own predictors, not null
    expect(observations[0]?.predictors.files_touched_estimate).toBe(3);
    expect(observations[0]?.predictors.layers_crossed).toBe(2);
    expect(observations[0]?.predictor_quality).toBe("observed");
  }, 45_000);

  it("should-5: rejects an invalid --since with a clear message instead of a raw RangeError", async () => {
    const result = await runCalibrate(intentId, {
      specDir,
      sessionIds: ["lane-test-nonexistent-session-id"],
      agentCostBin: bin ?? undefined,
      since: "not-a-real-timestamp",
    });
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/--since/);
    expect(result.message).toMatch(/invalid ISO 8601 timestamp/);
  });

  it("re-running with the same session ids overwrites the same observation record (idempotent)", async () => {
    await runCalibrate(intentId, {
      specDir,
      sessionIds: ["lane-test-nonexistent-session-id"],
      agentCostBin: bin ?? undefined,
      ...FAST_WINDOW,
    });
    await runCalibrate(intentId, {
      specDir,
      sessionIds: ["lane-test-nonexistent-session-id"],
      agentCostBin: bin ?? undefined,
      ...FAST_WINDOW,
    });
    expect(listObservations()).toHaveLength(1);
  }, 90_000);

  it("records a prediction_evaluation once a baseline estimate revision is adopted", async () => {
    runEstimate(intentId, { specDir, adopt: true });
    const intent = readIntent(specDir, intentId);
    expect(intent.baseline_estimate_revision_id).toBe("r1");
    writeIntent(specDir, intentId, intent); // no-op write, just exercising the store round-trip

    const result = await runCalibrate(intentId, {
      specDir,
      sessionIds: ["lane-test-nonexistent-session-id"],
      agentCostBin: bin ?? undefined,
      ...FAST_WINDOW,
    });
    expect(result.exitCode, result.message).toBe(0);
    expect(result.message).toContain("prediction_evaluation");
    expect(result.message).toContain("vs baseline r1");
  }, 45_000);

  it("fails when the lane was never started", async () => {
    const result = await runCalibrate("I-2026-07-31-never-started", {
      specDir,
      sessionIds: ["s1"],
      agentCostBin: bin ?? undefined,
    });
    expect(result.exitCode).toBe(2);
  });
});
