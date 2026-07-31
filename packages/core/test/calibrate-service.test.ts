import type { AgentCostMeasureResult, Predictors } from "@lane/schemas";
import { describe, expect, it } from "vitest";
import {
  buildObservationFromMeasurement,
  evaluatePrediction,
} from "../src/application/calibrate-service.js";

const predictors: Predictors = {
  files_touched_estimate: 3,
  files_touched_observed: 4,
  layers_crossed: 1,
  risk_class: "low",
  spec_rule_count: 2,
  novel_surface: "false",
};

function measurement(
  overrides: Partial<AgentCostMeasureResult["total"]["totals"]> = {},
  matched = true,
): AgentCostMeasureResult {
  const totals = {
    tokens: 120_000,
    priced_tokens: 120_000,
    unpriced_tokens: 0,
    estimated_cost_usd: 3.1,
    credits: 0,
    ...overrides,
  };
  return {
    protocol_version: "measure/v1",
    generated_at: "2026-07-31T09:00:00Z",
    window: { since: null, until: null },
    timezone: "UTC",
    agent: ["claude"],
    rates: { catalog_version: "2026-07-29", sha256: "abc" },
    session_ids: ["sess-1"],
    sessions: { "sess-1": { matched, rows: [], totals } },
    total: { rows: [], totals },
    data_quality: {
      malformed_events: 0,
      skipped_files: 0,
      negative_deltas: 0,
      unpriced_tokens: totals.unpriced_tokens,
      source_quality: { ok: 1 },
    },
  };
}

describe("buildObservationFromMeasurement", () => {
  it("builds a fully-priced, knn-eligible observation from a matched measurement", () => {
    const obs = buildObservationFromMeasurement({
      recordId: "cal-0001",
      intentId: "I-2026-07-31-example-feature",
      recordedAt: "2026-07-31T09:00:00+09:00",
      predictors,
      predictorQuality: "observed",
      measurement: measurement(),
    });
    expect(obs.actual.tokens).toBe(120_000);
    expect(obs.actual.pricing_status).toBe("priced");
    expect(obs.eligible_for_knn).toBe(true);
    expect(obs.provenance).toBe("measured");
  });

  it("marks pricing_status=unpriced and excludes from knn when any tokens are unpriced", () => {
    const obs = buildObservationFromMeasurement({
      recordId: "cal-0002",
      intentId: "I-2026-07-31-example-feature",
      recordedAt: "2026-07-31T09:00:00+09:00",
      predictors,
      predictorQuality: "observed",
      measurement: measurement({ unpriced_tokens: 500 }),
    });
    expect(obs.actual.pricing_status).toBe("unpriced");
    expect(obs.eligible_for_knn).toBe(false);
  });

  it("excludes from knn when no session actually matched", () => {
    const obs = buildObservationFromMeasurement({
      recordId: "cal-0003",
      intentId: "I-2026-07-31-example-feature",
      recordedAt: "2026-07-31T09:00:00+09:00",
      predictors,
      predictorQuality: "observed",
      measurement: measurement({ tokens: 0, estimated_cost_usd: 0 }, false),
    });
    expect(obs.eligible_for_knn).toBe(false);
  });
});

describe("evaluatePrediction", () => {
  it("computes relative error and p80 coverage for tokens and cost_usd", () => {
    const obs = buildObservationFromMeasurement({
      recordId: "cal-0004",
      intentId: "I-2026-07-31-example-feature",
      recordedAt: "2026-07-31T09:00:00+09:00",
      predictors,
      predictorQuality: "observed",
      measurement: measurement(),
    });
    const evaluation = evaluatePrediction(
      obs,
      {
        revision_id: "r1",
        estimated_at: "2026-07-31T08:00:00+09:00",
        as_of_phase: "1_intent",
        repo_commit: "abc",
        estimator_version: "0.1.0",
        predictors,
        predicted: { tokens: { p50: 100_000, p80: 150_000 }, cost_usd: { p50: 3, p80: 5 } },
        neighbors: [],
        population_condition: { population_size: 0, method: "reference_table", experimental: true },
      },
      "eval-0001",
      "2026-07-31T09:05:00+09:00",
    );
    expect(evaluation.error.tokens?.relative_error_p50).toBeCloseTo(0.2, 5);
    expect(evaluation.error.tokens?.covered_by_p80).toBe(true);
    expect(evaluation.error.cost_usd?.covered_by_p80).toBe(true);
  });
});
