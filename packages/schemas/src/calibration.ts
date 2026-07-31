import { z } from "zod";
import { Iso8601Schema, MeasurementQualitySchema } from "./common.js";
import { PredictedSchema, PredictorsSchema } from "./estimate.js";

// design.md §2.7 — observation (predictors + actual, always available) and prediction
// evaluation (estimate_revision_id + predicted + error, only available once a baseline
// estimate existed) are different things: data imported from a legacy ledger is
// observation-only (no prior prediction to evaluate) and still needs to participate in
// the k-NN population.
export const CalibrationObservationSchema = z.object({
  schema_version: z.string(),
  record_id: z.string(),
  kind: z.literal("observation"),
  intent_id: z.string(),
  recorded_at: Iso8601Schema,
  predictors: PredictorsSchema,
  predictor_quality: MeasurementQualitySchema,
  actual: z
    .object({
      tokens: z.number().nonnegative().optional(),
      cycle_time_min: z.number().nonnegative().optional(),
      estimated_cost_usd: z.number().nonnegative().optional(),
      credits: z.number().nonnegative().optional(),
      pricing_catalog_version: z.string().optional(),
      pricing_status: z.enum(["priced", "unpriced", "stale"]).optional(),
    })
    .describe("Missing metrics are omitted, never represented as 0."),
  measurement_quality: MeasurementQualitySchema,
  eligible_for_knn: z.boolean(),
  provenance: z.enum(["measured", "imported_legacy_ledger"]),
});
export type CalibrationObservation = z.infer<typeof CalibrationObservationSchema>;

export const CalibrationPredictionEvaluationSchema = z.object({
  schema_version: z.string(),
  record_id: z.string(),
  kind: z.literal("prediction_evaluation"),
  intent_id: z.string(),
  estimate_revision_id: z.string(),
  evaluated_at: Iso8601Schema,
  predicted: PredictedSchema,
  actual_record_id: z.string().describe("record_id of the corresponding observation record."),
  error: z.object({
    tokens: z
      .object({
        relative_error_p50: z.number(),
        covered_by_p80: z.boolean(),
      })
      .optional(),
    cost_usd: z
      .object({
        relative_error_p50: z.number(),
        covered_by_p80: z.boolean(),
      })
      .optional(),
  }),
});
export type CalibrationPredictionEvaluation = z.infer<typeof CalibrationPredictionEvaluationSchema>;

export const CalibrationRecordSchema = z.discriminatedUnion("kind", [
  CalibrationObservationSchema,
  CalibrationPredictionEvaluationSchema,
]);
export type CalibrationRecord = z.infer<typeof CalibrationRecordSchema>;
