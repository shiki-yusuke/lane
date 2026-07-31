import { AgentCostTelemetryAdapter, TelemetryImportFailed } from "@lane/adapters";
import {
  buildObservationFromMeasurement,
  buildPredictorsFromIntent,
  computeDigest,
  evaluatePrediction,
  findBaselineRevision,
} from "@lane/core";
import type { MeasurementQuality } from "@lane/schemas";
import { listObservations, writeCalibrationRecord } from "../calibration-store.js";
import { readEstimateIfExists } from "../estimate-store.js";
import { intentExists, readIntent } from "../intent-store.js";
import { resolveSpecDir } from "../spec-dir.js";
import { laneStateExists } from "../state-store.js";
import { readVerificationIfExists } from "../verification-store.js";
import type { CommandResult } from "./start.js";

export interface CalibrateOptions {
  specDir?: string;
  sessionIds: string[];
  since?: string;
  until?: string;
  agentCostBin?: string;
  /** Actual diff file count post-implementation (design.md §2.6's files_touched_observed). */
  filesTouchedObserved?: number;
}

/**
 * Parses a `--since`/`--until` CLI value into a `Date`, or a human-readable error instead
 * of letting an invalid string reach `Date.toISOString()` downstream (should-5, M2 review,
 * 2026-07-31 — `new Date("garbage")` doesn't throw, but the agent-cost adapter's
 * `toPythonIsoformat()` calling `.toISOString()` on the resulting Invalid Date does, with a
 * raw `RangeError` that doesn't say which flag was at fault).
 */
function parseTimestampOption(
  flagName: string,
  raw: string | undefined,
): { date?: Date; error?: string } {
  if (!raw) return {};
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return { error: `${flagName}: invalid ISO 8601 timestamp: ${raw}` };
  }
  return { date };
}

/**
 * `lane calibrate <intent-id> --session-id <id> [--session-id <id> ...]` — measures real
 * usage for the given session ids via agent-cost (design.md §4.1), builds one
 * CalibrationObservation, and — only if intent.baseline_estimate_revision_id is set —
 * one CalibrationPredictionEvaluation scoring that baseline against the new observation.
 * Never touches estimate.json (design.md §5.1: calibrate only ever *reads* the adopted
 * baseline).
 *
 * record_id is derived deterministically from (intentId, sessionIds, since, until) rather
 * than a timestamp, so re-running calibrate for the exact same measured window is
 * idempotent (design.md §2.7: "record_id を主キーにすることで lane calibrate の再実行が冪等になる") —
 * it overwrites the same file instead of accumulating duplicate observations.
 */
export async function runCalibrate(
  intentId: string,
  opts: CalibrateOptions,
): Promise<CommandResult> {
  const specDir = resolveSpecDir({ override: opts.specDir });

  if (!laneStateExists(specDir, intentId)) {
    return { exitCode: 2, message: `Lane state not found: ${intentId}` };
  }
  if (!intentExists(specDir, intentId)) {
    return { exitCode: 2, message: `intent.yaml not found for ${intentId}` };
  }
  if (opts.sessionIds.length === 0) {
    return { exitCode: 1, message: "at least one --session-id is required" };
  }

  const since = parseTimestampOption("--since", opts.since);
  if (since.error) return { exitCode: 1, message: since.error };
  const until = parseTimestampOption("--until", opts.until);
  if (until.error) return { exitCode: 1, message: until.error };

  const intent = readIntent(specDir, intentId);
  const verification = readVerificationIfExists(specDir, intentId);

  const adapter = new AgentCostTelemetryAdapter({ bin: opts.agentCostBin });
  let measurement: Awaited<ReturnType<AgentCostTelemetryAdapter["measure"]>>;
  try {
    measurement = await adapter.measure(opts.sessionIds, {
      since: since.date,
      until: until.date,
    });
  } catch (err) {
    if (err instanceof TelemetryImportFailed) {
      return { exitCode: 2, message: `telemetry measurement failed: ${err.message}` };
    }
    throw err;
  }

  // must-1 (M2 review, 2026-07-31): rebuilding predictors from scratch here (as before)
  // always passed impactScan=undefined, silently reverting files_touched_estimate/
  // layers_crossed to null even when the adopted baseline revision *does* carry a real
  // impact-scan snapshot — degrading the k-NN population this very observation feeds back
  // into. When a baseline is adopted, carry its predictors over verbatim instead (they're
  // exactly what was estimated against, so reusing them is more faithful than
  // recomputing); only fall back to a freshly-built (necessarily impact-scan-less)
  // Predictors when there's no baseline to read from, and mark that case `imputed` rather
  // than `observed` since the impact-scan-derived dimensions are then genuinely unknown.
  // Read once and reused below for the prediction_evaluation step too.
  const estimate = readEstimateIfExists(specDir, intentId);
  const baseline = estimate ? findBaselineRevision(intent, estimate) : undefined;
  const predictors = baseline
    ? { ...baseline.predictors }
    : buildPredictorsFromIntent(intent, undefined, verification ?? undefined);
  const predictorQuality: MeasurementQuality = baseline ? "observed" : "imputed";
  if (opts.filesTouchedObserved != null)
    predictors.files_touched_observed = opts.filesTouchedObserved;

  const recordId = `cal-${computeDigest(
    JSON.stringify({
      intentId,
      sessionIds: [...opts.sessionIds].sort(),
      since: opts.since ?? null,
      until: opts.until ?? null,
    }),
  ).slice(0, 16)}`;
  const now = new Date().toISOString();

  const observation = buildObservationFromMeasurement({
    recordId,
    intentId,
    recordedAt: now,
    predictors,
    predictorQuality,
    measurement,
  });
  writeCalibrationRecord(observation);

  const lines = [
    `observation ${recordId}: tokens=${observation.actual.tokens} cost_usd=${observation.actual.estimated_cost_usd} pricing_status=${observation.actual.pricing_status} eligible_for_knn=${observation.eligible_for_knn}`,
  ];

  if (baseline) {
    const evalRecordId = `eval-${recordId}-${baseline.revision_id}`;
    const evaluation = evaluatePrediction(observation, baseline, evalRecordId, now);
    writeCalibrationRecord(evaluation);
    lines.push(
      `prediction_evaluation ${evalRecordId} vs baseline ${baseline.revision_id}: ` +
        `tokens relative_error_p50=${evaluation.error.tokens?.relative_error_p50} covered_by_p80=${evaluation.error.tokens?.covered_by_p80}`,
    );
  } else {
    lines.push(
      "intent has no baseline_estimate_revision_id adopted yet — no prediction_evaluation recorded",
    );
  }

  const population = listObservations();
  lines.push(`calibration population is now ${population.length} observation(s)`);

  return { exitCode: 0, message: lines.join("\n") };
}
