import { describe, expect, it } from "vitest";
import { buildObservationFromLegacyLaneState } from "../src/migrate-legacy-ledger.js";

// Fixtures below mirror the *real* field shapes found in the salvaged archive during M2
// implementation (docs/spec/<intent-id>/lane-state.json + intent.yaml), with values
// replaced by generic placeholders (no real ticket ids/repo names) per this repo's
// sanitize policy.

const currentShapeLedgerEntry = {
  ledger_entry_id: "lc_abc123",
  lane_id: "I-2026-01-01-example-1",
  phase: "1_intent",
  scope: "phase",
  usage: {
    claude_input_tokens: 5000,
    claude_output_tokens: 20000,
    codex_input_tokens: 0,
    codex_output_tokens: 0,
  },
  cost_usd_estimate: 3.5,
  source: "claude_jsonl_auto",
  pricing_version: "2026-01",
  data_state: "has_usage",
  confidence: "imported_windowed",
  included_in_kpi: true,
};

const oldShapeLedgerEntry = {
  phase: "lane_total",
  scope: "lane_total",
  usage: {
    claude_input_tokens: 0,
    claude_output_tokens: 0,
    codex_input_tokens: 1000,
    codex_output_tokens: 500,
  },
  cost_usd_estimate: 1.2,
  source: "codex_sqlite_auto",
  pricing_version: "2026-01",
  // no ledger_entry_id / data_state / included_in_kpi — an older, pre-rename entry shape
};

function laneState(entries: unknown[]) {
  return { intent_id: "I-2026-01-01-example-1", cost_ledger: entries };
}

const legacyIntent = {
  intent: { risk_level: "medium" },
  ai_inferred_scope: { affected_layers: ["presenter", "adapter"] },
};

describe("buildObservationFromLegacyLaneState", () => {
  it("imports a lane-state.json with a current-shape, included_in_kpi entry", () => {
    const result = buildObservationFromLegacyLaneState(
      laneState([currentShapeLedgerEntry]),
      legacyIntent,
      "cal-legacy-I-2026-01-01-example-1",
      "2026-07-31T09:00:00+09:00",
    );
    expect("observation" in result).toBe(true);
    if ("observation" in result) {
      expect(result.observation.actual.tokens).toBe(25_000);
      expect(result.observation.actual.estimated_cost_usd).toBe(3.5);
      expect(result.observation.predictors.risk_class).toBe("medium");
      expect(result.observation.predictors.layers_crossed).toBe(2);
      expect(result.observation.predictor_quality).toBe("reconstructed");
      expect(result.observation.provenance).toBe("imported_legacy_ledger");
    }
  });

  it("sums tokens/cost across multiple usable entries", () => {
    const second = {
      ...currentShapeLedgerEntry,
      ledger_entry_id: "lc_def456",
      usage: {
        claude_input_tokens: 1000,
        claude_output_tokens: 1000,
        codex_input_tokens: 0,
        codex_output_tokens: 0,
      },
      cost_usd_estimate: 0.5,
    };
    const result = buildObservationFromLegacyLaneState(
      laneState([currentShapeLedgerEntry, second]),
      undefined,
      "cal-legacy-multi",
      "2026-07-31T09:00:00+09:00",
    );
    expect("observation" in result).toBe(true);
    if ("observation" in result) {
      expect(result.observation.actual.tokens).toBe(27_000);
      expect(result.observation.actual.estimated_cost_usd).toBe(4);
    }
  });

  it("falls back to imputed/low-risk predictors when no intent.yaml is available", () => {
    const result = buildObservationFromLegacyLaneState(
      laneState([currentShapeLedgerEntry]),
      undefined,
      "cal-legacy-no-intent",
      "2026-07-31T09:00:00+09:00",
    );
    expect("observation" in result).toBe(true);
    if ("observation" in result) {
      expect(result.observation.predictors.risk_class).toBe("low");
      expect(result.observation.predictor_quality).toBe("imputed");
      expect(result.observation.predictors.layers_crossed).toBeNull();
    }
  });

  it("rejects an old (pre-rename) shaped entry (no ledger_entry_id/data_state) when it's the only entry", () => {
    const result = buildObservationFromLegacyLaneState(
      laneState([oldShapeLedgerEntry]),
      legacyIntent,
      "cal-legacy-old",
      "2026-07-31T09:00:00+09:00",
    );
    expect("reject" in result).toBe(true);
  });

  it("succeeds on a lane with 1 usable + 1 old-shaped entry, but surfaces the old-shaped one via entryRejects (must-4: never a silent drop)", () => {
    const result = buildObservationFromLegacyLaneState(
      laneState([currentShapeLedgerEntry, oldShapeLedgerEntry]),
      legacyIntent,
      "cal-legacy-mixed",
      "2026-07-31T09:00:00+09:00",
    );
    expect("observation" in result).toBe(true);
    if ("observation" in result) {
      expect(result.observation.actual.tokens).toBe(25_000); // only the usable entry counted
      expect(result.entryRejects).toHaveLength(1);
      expect(result.entryRejects[0]).toContain("cost_ledger[1]");
    }
  });

  it("rejects a lane-state.json with no cost_ledger entries at all", () => {
    const result = buildObservationFromLegacyLaneState(
      laneState([]),
      legacyIntent,
      "cal-legacy-empty",
      "2026-07-31T09:00:00+09:00",
    );
    expect("reject" in result).toBe(true);
  });

  it("rejects a lane-state.json that doesn't even have intent_id", () => {
    const result = buildObservationFromLegacyLaneState(
      { not_intent_id: true },
      undefined,
      "cal-legacy-bad",
      "2026-07-31T09:00:00+09:00",
    );
    expect("reject" in result).toBe(true);
  });

  it("excludes entries with included_in_kpi=false or an unusable data_state", () => {
    const excluded1 = { ...currentShapeLedgerEntry, included_in_kpi: false };
    const excluded2 = {
      ...currentShapeLedgerEntry,
      ledger_entry_id: "lc_x",
      data_state: "no_data",
    };
    const result = buildObservationFromLegacyLaneState(
      laneState([excluded1, excluded2]),
      undefined,
      "cal-legacy-excluded",
      "2026-07-31T09:00:00+09:00",
    );
    expect("reject" in result).toBe(true);
  });
});
