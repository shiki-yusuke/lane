import { z } from "zod";

// design.md §2.2 — shared across intent/critic/estimate/calibration/lane-state.
export const RiskLevelSchema = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

// design.md §2.7/§3.5 — how a measured/derived value was obtained.
export const MeasurementQualitySchema = z.enum(["observed", "reconstructed", "imputed"]);
export type MeasurementQuality = z.infer<typeof MeasurementQualitySchema>;

// the Python reference implementation's now_iso() (orchestrator.py) emits datetime.now(JST).isoformat(), which
// produces a "+09:00" offset, not a "Z" suffix. zod's z.string().datetime() defaults to
// requiring "Z" and would reject every timestamp lane itself writes, so all
// operational timestamps in these schemas use this offset-permitting variant instead.
export const Iso8601Schema = z.string().datetime({ offset: true });
