import { z } from "zod";
import { Iso8601Schema, RiskLevelSchema } from "./common.js";
import { PhaseSchema } from "./phase.js";

// design.md §2.5 — the Python reference implementation's lane-state.schema.json declared
// phase_history[].result as an enum with no "in_progress" value, yet the running code path
// (cmd_advance) writes an in-progress entry before it is closed out; that is a real
// schema/implementation gap, not a design choice, and rev2 fixes it here rather than
// reproducing it.
export const PhaseHistoryEntrySchema = z.object({
  phase: PhaseSchema,
  started_at: Iso8601Schema,
  ended_at: Iso8601Schema.optional(),
  result: z.enum(["in_progress", "completed", "halted", "needs_revision", "aborted"]),
  retry_count: z.number().int().nonnegative().default(0),
});
export type PhaseHistoryEntry = z.infer<typeof PhaseHistoryEntrySchema>;

export const HaltInfoSchema = z.object({
  halt_type: z.enum(["hard", "retry_exceeded", "needs_revision_escalated"]),
  halt_reason: z.string(),
  failing_command: z.string().optional(),
  critic_excerpt: z.string().optional(),
  paused_at: Iso8601Schema,
  user_instruction: z.string().nullable().default(null),
});
export type HaltInfo = z.infer<typeof HaltInfoSchema>;

export const RetryLogEntrySchema = z.object({
  fingerprint: z.string().describe("failure kind + error signature"),
  count: z.number().int().min(1),
  limit: z.number().int().min(1).optional(),
  last_seen_at: Iso8601Schema.optional(),
});
export type RetryLogEntry = z.infer<typeof RetryLogEntrySchema>;

// design.md §3.6/§10 Goodhart guard: this is aggregate process telemetry, not a per-person
// metric, so none of these keys may collide with core/goodhart.ts's PERSONAL_DIMENSION_KEYS.
export const MetricsSchema = z.object({
  ai_drafted: z.boolean().optional(),
  human_intervention_count: z.number().int().nonnegative().optional(),
  halt_count: z.number().int().nonnegative().optional(),
  false_halt_count: z.number().int().nonnegative().optional(),
  rework_commit_count: z.number().int().nonnegative().optional(),
});
export type Metrics = z.infer<typeof MetricsSchema>;

// design.md §2.5 — previously an ad-hoc dict; now a typed ledger entry. Field names are a
// rev2 redesign (tokens/turns/cost_usd/cost_credits, session_ids[] for §3.6 window union)
// and intentionally do not mirror the Python reference implementation's build_ledger_entry() dict shape 1:1 — the
// *derivation rules* (entry id / confidence / data_state / included_in_kpi) are what M1's
// differential tests port byte-for-byte, not the on-disk entry shape.
export const LedgerEntrySchema = z.object({
  ledger_entry_id: z.string(),
  lane_id: z.string().nullable(),
  phase: PhaseSchema,
  source: z.enum(["manual", "claude_jsonl_auto", "codex_sqlite_auto"]),
  scope: z.enum(["phase", "lane"]),
  session_ids: z.array(z.string()).default([]),
  data_state: z.enum(["no_data", "zero_tokens", "has_usage", "import_failed", "superseded"]),
  confidence: z.enum(["imported_windowed", "imported_lane", "estimated", "manual"]),
  included_in_kpi: z.boolean(),
  tokens: z.number().nonnegative().nullable(),
  turns: z.number().int().nonnegative().nullable(),
  cost_usd: z.number().nonnegative().nullable(),
  cost_credits: z.number().nonnegative().nullable(),
  pricing_version: z.string().nullable(),
  pricing_as_of: Iso8601Schema.nullable(),
  imported_at: Iso8601Schema,
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const UsageImportAttemptSchema = z.object({
  lane_id: z.string().nullable(),
  phase: PhaseSchema,
  scope: z.enum(["phase", "lane"]),
  source: z.enum(["claude_jsonl_auto", "codex_sqlite_auto"]),
  exit_status: z.enum(["success", "failed"]),
  data_state: z.string(),
  attempted_at: Iso8601Schema,
});
export type UsageImportAttempt = z.infer<typeof UsageImportAttemptSchema>;

export const GateOverrideSchema = z.object({
  gate_id: z.string(),
  reason: z.string(),
  actor: z.string(),
  overridden_at: Iso8601Schema,
});
export type GateOverride = z.infer<typeof GateOverrideSchema>;

// design.md §3.4 — audit log of the gate-time effective risk, kept separate from
// intent.intent.declared_risk (which is immutable).
export const EffectiveRiskEvaluationSchema = z.object({
  gate_id: z.string(),
  effective_risk: RiskLevelSchema,
  applied_rule_ids: z.array(z.string()),
  profile_digest: z.string(),
  evaluated_at: Iso8601Schema,
});
export type EffectiveRiskEvaluation = z.infer<typeof EffectiveRiskEvaluationSchema>;

export const ModeResolutionSchema = z.object({
  requested_mode: z.enum(["manual", "semi_auto", "auto"]),
  effective_mode: z.enum(["manual", "semi_auto", "auto"]),
  applied_rule_id: z.string().nullable(),
  resolved_at: Iso8601Schema,
});
export type ModeResolution = z.infer<typeof ModeResolutionSchema>;

export const LaneStateSchemaV2 = z
  .object({
    schema_version: z.literal("2.0"),
    intent_id: z.string(),
    tracker_url: z.string().nullable(),
    pr_url: z.string().nullable(),
    pr_provenance: z.enum(["advance", "done_overlay", "sync_done"]).nullable().default(null),
    owner: z.string().nullable(),
    current_phase: PhaseSchema,
    status: z.enum(["pending", "running", "paused", "completed", "aborted"]),
    created_at: Iso8601Schema,
    updated_at: Iso8601Schema.optional(),
    phase_history: z.array(PhaseHistoryEntrySchema).default([]),
    halt_info: HaltInfoSchema.nullable().default(null),
    retry_log: z.array(RetryLogEntrySchema).default([]),
    effective_risk_log: z.array(EffectiveRiskEvaluationSchema).default([]),
    mode_resolution_log: z.array(ModeResolutionSchema).default([]),
    cost_ledger: z.array(LedgerEntrySchema).default([]),
    usage_import_attempts: z.array(UsageImportAttemptSchema).default([]),
    usage_import_gate_overrides: z.array(GateOverrideSchema).default([]),
    metrics: MetricsSchema.optional(),
  })
  // Unknown keys are preserved rather than stripped: silently dropping a future field on
  // every read/write round-trip would be a real (if slow) data-loss bug, not just a type
  // nuisance. Known fields above are still strictly validated; only *unknown* keys pass
  // through untouched.
  .passthrough();
export type LaneState = z.infer<typeof LaneStateSchemaV2>;

// Pre-rev2 shape: same idea, but phase_history.result has no "in_progress" value (the
// gap fixed above) and the rev2-only audit logs are absent. There is no
// real "1.0" population for this greenfield TS tool yet; this schema/migration exists so
// that if a lane-state.json is ever produced before this fix lands, `lane` does not choke
// on it.
export const LaneStateSchemaV1 = z
  .object({
    schema_version: z.literal("1.0").optional(),
    intent_id: z.string(),
    tracker_url: z.string().nullable().optional(),
    pr_url: z.string().nullable().optional(),
    owner: z.string().nullable().optional(),
    current_phase: PhaseSchema,
    status: z.enum(["pending", "running", "paused", "completed", "aborted"]),
    created_at: Iso8601Schema,
    updated_at: Iso8601Schema.optional(),
    phase_history: z
      .array(
        z.object({
          phase: PhaseSchema,
          started_at: Iso8601Schema,
          ended_at: Iso8601Schema.optional(),
          result: z.enum(["completed", "halted", "needs_revision", "aborted"]),
          retry_count: z.number().int().nonnegative().default(0),
        }),
      )
      .default([]),
    halt_info: HaltInfoSchema.nullable().default(null),
    retry_log: z.array(RetryLogEntrySchema).default([]),
    cost_ledger: z.array(LedgerEntrySchema).default([]),
    usage_import_attempts: z.array(UsageImportAttemptSchema).default([]),
    usage_import_gate_overrides: z.array(GateOverrideSchema).default([]),
    metrics: MetricsSchema.optional(),
  })
  .passthrough();
export type LaneStateV1 = z.infer<typeof LaneStateSchemaV1>;

export function migrateLaneStateV1ToV2(v1: LaneStateV1): LaneState {
  return LaneStateSchemaV2.parse({
    ...v1,
    schema_version: "2.0",
    tracker_url: v1.tracker_url ?? null,
    pr_url: v1.pr_url ?? null,
    pr_provenance: null,
    owner: v1.owner ?? null,
    // "in_progress" never appears in a v1 file by construction (the enum didn't allow it),
    // so every v1 phase_history entry is already a valid v2 entry as-is.
    phase_history: v1.phase_history,
    effective_risk_log: [],
    mode_resolution_log: [],
  });
}

/**
 * Version-dispatching parse: routes to the matching schema (v1 -> migrate, v2 -> parse
 * directly) instead of assuming every lane-state.json on disk is already current
 * (design.md §2.5 / sol 裁定: "schema version is version dispatcher + migration").
 */
export function parseLaneState(raw: unknown): LaneState {
  const version = (raw as { schema_version?: string } | null | undefined)?.schema_version;
  if (version === "2.0") {
    return LaneStateSchemaV2.parse(raw);
  }
  return migrateLaneStateV1ToV2(LaneStateSchemaV1.parse(raw));
}
