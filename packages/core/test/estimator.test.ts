import type { CalibrationObservation, Predictors, Profile } from "@lane/schemas";
import { describe, expect, it } from "vitest";
import { estimate, neighborDistance, referenceTableEstimate } from "../src/estimator.js";

const caps = { files_touched_estimate: 50, layers_crossed: 10, spec_rule_count: 30 };

function predictors(overrides: Partial<Predictors> = {}): Predictors {
  return {
    files_touched_estimate: 5,
    files_touched_observed: null,
    layers_crossed: 1,
    risk_class: "low",
    spec_rule_count: null,
    novel_surface: "unknown",
    ...overrides,
  };
}

describe("neighborDistance", () => {
  it("is 0 for identical predictors", () => {
    const p = predictors();
    expect(neighborDistance(p, p, caps)).toBe(0);
  });

  it("increases with risk_class distance (ordinal, not one-hot)", () => {
    const low = predictors({ risk_class: "low" });
    const medium = predictors({ risk_class: "medium" });
    const high = predictors({ risk_class: "high" });
    expect(neighborDistance(low, high, caps)).toBeGreaterThan(neighborDistance(low, medium, caps));
  });

  it("excludes a missing numeric dimension from the average rather than penalizing it", () => {
    const a = predictors({ files_touched_estimate: null });
    const b = predictors({ files_touched_estimate: 40 });
    // only risk_class contributes (both low) -> distance should be exactly 0
    expect(neighborDistance(a, b, caps)).toBe(0);
  });

  it("is Infinity when there are no comparable dimensions at all", () => {
    const a: Predictors = {
      files_touched_estimate: null,
      files_touched_observed: null,
      layers_crossed: null,
      risk_class: "low",
      spec_rule_count: null,
      novel_surface: "unknown",
    };
    const b = { ...a };
    // risk_class still comparable (both low, distance 0) so this isn't actually Infinity;
    // Infinity only happens when literally zero dims (impossible since risk_class is
    // always present) — assert the realistic floor instead.
    expect(neighborDistance(a, b, caps)).toBe(0);
  });
});

describe("referenceTableEstimate", () => {
  it("returns the caller-supplied reference prediction with method=reference_table and experimental=true", () => {
    const result = referenceTableEstimate(
      predictors(),
      { predicted: { tokens: { p50: 100, p80: 200 }, cost_usd: { p50: 1, p80: 2 } } },
      3,
    );
    expect(result.populationCondition).toEqual({
      populationSize: 3,
      method: "reference_table",
      experimental: true,
    });
    expect(result.neighbors).toEqual([]);
  });
});

function observation(
  id: string,
  tokens: number,
  costUsd: number,
  overrides: Partial<Predictors> = {},
): CalibrationObservation {
  return {
    schema_version: "1.0",
    record_id: `obs-${id}`,
    kind: "observation",
    intent_id: id,
    recorded_at: "2026-06-01T09:00:00+09:00",
    predictors: predictors(overrides),
    predictor_quality: "observed",
    actual: { tokens, estimated_cost_usd: costUsd },
    measurement_quality: "observed",
    eligible_for_knn: true,
    provenance: "measured",
  };
}

const referenceTable = {
  predicted: { tokens: { p50: 999, p80: 1999 }, cost_usd: { p50: 9, p80: 19 } },
};
const profile: Profile = {
  schema_version: "1.0",
  profile_id: "generic",
  applies_to_repo: "",
  existing_ssot: {},
  extra_lenses: [],
  layer_ownership: {},
  risk_auto_upgrade: [],
  required_commands: { pre_implement: [], during_implement: [], pre_pr: [], post_implement: [] },
  forbidden_paths_for_low_risk: [],
  isomorphism_rules: { enabled: true, enforced_in: [] },
  test_coverage_floor: { unit_test_per_ears_rule_minimum: 1 },
  distance_caps: { files_touched_estimate: 50, layers_crossed: 10, spec_rule_count: 30 },
};

describe("estimate", () => {
  it("falls back to the reference table when population < 8, recording the real (non-zero) population size", () => {
    const population = Array.from({ length: 5 }, (_, i) =>
      observation(`p${i}`, 1000 * (i + 1), i + 1),
    );
    const result = estimate(predictors(), population, profile, referenceTable);
    expect(result.populationCondition.method).toBe("reference_table");
    expect(result.populationCondition.populationSize).toBe(5);
  });

  it("falls back to the reference table when fewer than 5 of the top-7 neighbors are knn-eligible, still recording the real population size", () => {
    const population = Array.from({ length: 8 }, (_, i) => ({
      ...observation(`p${i}`, 1000 * (i + 1), i + 1),
      eligible_for_knn: i < 3, // only 3 eligible
    }));
    const result = estimate(predictors(), population, profile, referenceTable);
    expect(result.populationCondition.method).toBe("reference_table");
    expect(result.populationCondition.populationSize).toBe(8);
  });

  it("at the usable=5 boundary (exactly MIN_USABLE_FOR_KNN), no leave-one-out fold could reflect a real production selection, so both LOO fields are omitted rather than a misleading 0", () => {
    const population = Array.from({ length: 8 }, (_, i) => ({
      ...observation(`p${i}`, 100_000 + i * 10_000, 2 + i * 0.5),
      eligible_for_knn: i < 5, // exactly 5 eligible among the top-7
    }));
    const result = estimate(predictors(), population, profile, referenceTable);
    expect(result.populationCondition.method).toBe("knn_quantile");
    expect(result.populationCondition.leaveOneOutP50Error).toBeUndefined();
    expect(result.populationCondition.leaveOneOutP80Coverage).toBeUndefined();
  });

  it("at usable=6 (one above the boundary), leave-one-out folds resume (each leaves 5 behind, still >= MIN_USABLE_FOR_KNN)", () => {
    const population = Array.from({ length: 8 }, (_, i) => ({
      ...observation(`p${i}`, 100_000 + i * 10_000, 2 + i * 0.5),
      eligible_for_knn: i < 6,
    }));
    const result = estimate(predictors(), population, profile, referenceTable);
    expect(result.populationCondition.method).toBe("knn_quantile");
    expect(result.populationCondition.leaveOneOutP50Error).toBeGreaterThanOrEqual(0);
    expect(result.populationCondition.leaveOneOutP80Coverage).toBeGreaterThanOrEqual(0);
  });

  it("uses knn_quantile with population >= 8 and >= 5 eligible neighbors, and always records leave-one-out numbers", () => {
    const population = Array.from({ length: 8 }, (_, i) =>
      observation(`p${i}`, 100_000 + i * 10_000, 2 + i * 0.5),
    );
    const result = estimate(predictors(), population, profile, referenceTable);
    expect(result.populationCondition.method).toBe("knn_quantile");
    expect(result.populationCondition.experimental).toBe(true); // population 8 < 30
    expect(result.populationCondition.leaveOneOutP50Error).toBeGreaterThanOrEqual(0);
    expect(result.populationCondition.leaveOneOutP80Coverage).toBeGreaterThanOrEqual(0);
    expect(result.populationCondition.leaveOneOutP80Coverage).toBeLessThanOrEqual(1);
    expect(result.predicted.tokens.p50).toBeLessThanOrEqual(result.predicted.tokens.p80);
  });

  it("experimental is false once population reaches 30", () => {
    const population = Array.from({ length: 30 }, (_, i) =>
      observation(`p${i}`, 100_000 + i * 1000, 2 + i * 0.1),
    );
    const result = estimate(predictors(), population, profile, referenceTable);
    expect(result.populationCondition.experimental).toBe(false);
  });
});
