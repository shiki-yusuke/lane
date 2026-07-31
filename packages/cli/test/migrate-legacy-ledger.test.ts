import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listObservations } from "../src/calibration-store.js";
import { runMigrateLegacyLedger } from "../src/commands/migrate-legacy-ledger.js";

function writeLaneStateFixture(dir: string, intentId: string, hasUsableEntry: boolean): string {
  const laneStatePath = join(dir, "lane-state.json");
  const laneState = {
    intent_id: intentId,
    cost_ledger: hasUsableEntry
      ? [
          {
            ledger_entry_id: "lc_abc123",
            lane_id: intentId,
            phase: "1_intent",
            scope: "phase",
            usage: {
              claude_input_tokens: 1000,
              claude_output_tokens: 2000,
              codex_input_tokens: 0,
              codex_output_tokens: 0,
            },
            cost_usd_estimate: 1.5,
            source: "claude_jsonl_auto",
            pricing_version: "2026-01",
            data_state: "has_usage",
            confidence: "imported_windowed",
            included_in_kpi: true,
          },
        ]
      : [],
  };
  writeFileSync(laneStatePath, JSON.stringify(laneState));
  writeFileSync(
    join(dir, "intent.yaml"),
    [
      "intent:",
      "  risk_level: high",
      "ai_inferred_scope:",
      "  affected_layers:",
      "    - ui",
      "    - domain",
    ].join("\n"),
  );
  return laneStatePath;
}

describe("runMigrateLegacyLedger", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "lane-migrate-ledger-data-"));
    process.env.LANE_DATA_DIR = dataDir;
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: process.env.X = undefined coerces to the string "undefined", not real deletion
    delete process.env.LANE_DATA_DIR;
  });

  it("requires at least one --input", () => {
    const result = runMigrateLegacyLedger({ input: [] });
    expect(result.exitCode).toBe(1);
  });

  it("imports one observation per usable lane-state.json, writes a reject-report even when empty", () => {
    const srcDir = mkdtempSync(join(tmpdir(), "lane-migrate-ledger-src-"));
    const path = writeLaneStateFixture(srcDir, "I-2026-01-01-example-1", true);

    const result = runMigrateLegacyLedger({ input: [path] });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("imported 1");
    expect(result.message).toContain("rejected 0");

    const observations = listObservations();
    expect(observations).toHaveLength(1);
    expect(observations[0]?.intent_id).toBe("I-2026-01-01-example-1");
    expect(observations[0]?.predictors.risk_class).toBe("high");
  });

  it("rejects a lane-state.json with no usable cost_ledger entries and records it in reject-report.json", () => {
    const srcDir = mkdtempSync(join(tmpdir(), "lane-migrate-ledger-src2-"));
    const path = writeLaneStateFixture(srcDir, "I-2026-01-01-example-2", false);
    const rejectReportPath = join(dataDir, "reject-report.json");

    const result = runMigrateLegacyLedger({ input: [path], rejectReportPath });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("imported 0");
    expect(result.message).toContain("rejected 1");

    const report = JSON.parse(readFileSync(rejectReportPath, "utf-8"));
    expect(report.count).toBe(1);
    expect(report.rejects[0].sourcePath).toBe(path);
  });

  it("still imports a lane with a mixed old/current-shape cost_ledger, and records the old-shaped entry in reject-report.json (must-4: never a silent drop)", () => {
    const srcDir = mkdtempSync(join(tmpdir(), "lane-migrate-ledger-src4-"));
    const laneStatePath = join(srcDir, "lane-state.json");
    writeFileSync(
      laneStatePath,
      JSON.stringify({
        intent_id: "I-2026-01-01-example-4",
        cost_ledger: [
          {
            ledger_entry_id: "lc_abc123",
            data_state: "has_usage",
            included_in_kpi: true,
            usage: { claude_input_tokens: 1000, claude_output_tokens: 0 },
            cost_usd_estimate: 1,
          },
          // an older, pre-rename entry shape missing ledger_entry_id/data_state/included_in_kpi
          { usage: { codex_input_tokens: 500 }, cost_usd_estimate: 0.5 },
        ],
      }),
    );
    const rejectReportPath = join(dataDir, "reject-report.json");

    const result = runMigrateLegacyLedger({ input: [laneStatePath], rejectReportPath });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("imported 1");

    const observations = listObservations();
    expect(observations).toHaveLength(1);

    const report = JSON.parse(readFileSync(rejectReportPath, "utf-8"));
    expect(report.count).toBe(1);
    expect(report.rejects[0].sourcePath).toBe(laneStatePath);
    expect(report.rejects[0].reason).toContain("cost_ledger[1]");
  });

  it("is idempotent: re-running on the same input does not duplicate the observation", () => {
    const srcDir = mkdtempSync(join(tmpdir(), "lane-migrate-ledger-src3-"));
    const path = writeLaneStateFixture(srcDir, "I-2026-01-01-example-3", true);

    runMigrateLegacyLedger({ input: [path] });
    runMigrateLegacyLedger({ input: [path] });
    expect(listObservations()).toHaveLength(1);
  });

  it("reports a missing input file as a reject rather than crashing", () => {
    const result = runMigrateLegacyLedger({ input: ["/nonexistent/lane-state.json"] });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("rejected 1");
  });
});
