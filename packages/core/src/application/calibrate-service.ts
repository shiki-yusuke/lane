import {
  type AgentCostMeasureResult,
  type CalibrationObservation,
  CalibrationObservationSchema,
  type CalibrationPredictionEvaluation,
  type EstimateRevision,
  type MeasurementQuality,
  type Predictors,
} from "@lane/schemas";

// design.md §2.7/§3.8/§5.1 — `lane calibrate` only ever reads the adopted baseline
// revision; it never rewrites it. It creates one observation record from measured actuals
// and, if a baseline exists, one prediction-evaluation record scoring that baseline
// against the observation. Both are pure functions here: the caller (CLI, M2) is
// responsible for sourcing `actual` from the Telemetry adapter and appending the returned
// records to the calibration store.

function relativeError(predictedP50: number, actual: number): number {
  if (predictedP50 === 0) return actual === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (actual - predictedP50) / predictedP50;
}

export function evaluatePrediction(
  observation: CalibrationObservation,
  revision: EstimateRevision,
  recordId: string,
  evaluatedAt: string,
): CalibrationPredictionEvaluation {
  const error: CalibrationPredictionEvaluation["error"] = {};
  const actualTokens = observation.actual.tokens;
  if (actualTokens != null) {
    error.tokens = {
      relative_error_p50: relativeError(revision.predicted.tokens.p50, actualTokens),
      covered_by_p80: actualTokens <= revision.predicted.tokens.p80,
    };
  }
  const actualCost = observation.actual.estimated_cost_usd;
  if (actualCost != null) {
    error.cost_usd = {
      relative_error_p50: relativeError(revision.predicted.cost_usd.p50, actualCost),
      covered_by_p80: actualCost <= revision.predicted.cost_usd.p80,
    };
  }
  return {
    schema_version: "1.0",
    record_id: recordId,
    kind: "prediction_evaluation",
    intent_id: observation.intent_id,
    estimate_revision_id: revision.revision_id,
    evaluated_at: evaluatedAt,
    predicted: revision.predicted,
    actual_record_id: observation.record_id,
    error,
  };
}

export interface BuildObservationFromMeasurementInput {
  recordId: string;
  intentId: string;
  recordedAt: string;
  predictors: Predictors;
  predictorQuality: MeasurementQuality;
  measurement: AgentCostMeasureResult;
}

/**
 * Builds a CalibrationObservation (§2.7) from a real AgentCostTelemetryAdapter.measure()
 * result. `measurement.total` is agent-cost's own union-of-requested-sessions total
 * (design.md §4.1) — the right number to attribute to this one intent's measured window.
 *
 * pricing_status is "unpriced" whenever any of the measured tokens were unpriced (agent-
 * cost's data_quality.unpriced_tokens/session totals.unpriced_tokens > 0), not just when
 * *all* of them were — a partially-priced total is still not fully trustworthy.
 * eligible_for_knn mirrors that: a partially-unpriced or entirely-unmatched measurement
 * must not quietly pollute the k-NN population with an underestimated cost.
 */
export function buildObservationFromMeasurement(
  input: BuildObservationFromMeasurementInput,
): CalibrationObservation {
  const totals = input.measurement.total.totals;
  const fullyPriced = totals.unpriced_tokens === 0;
  const anyMatched = Object.values(input.measurement.sessions).some((s) => s.matched);

  return CalibrationObservationSchema.parse({
    schema_version: "1.0",
    record_id: input.recordId,
    kind: "observation",
    intent_id: input.intentId,
    recorded_at: input.recordedAt,
    predictors: input.predictors,
    predictor_quality: input.predictorQuality,
    actual: {
      tokens: totals.tokens,
      estimated_cost_usd: totals.estimated_cost_usd,
      credits: totals.credits,
      pricing_catalog_version: input.measurement.rates.catalog_version,
      pricing_status: fullyPriced ? "priced" : "unpriced",
    },
    measurement_quality: "observed",
    eligible_for_knn: anyMatched && fullyPriced,
    provenance: "measured",
  });
}
