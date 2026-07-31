import { z } from "zod";
import { ConfidenceSchema, Iso8601Schema, RiskLevelSchema } from "./common.js";

// design.md §2.2.
export const BudgetConstraintSchema = z.object({
  provider: z.enum(["claude", "codex", "any"]),
  unit: z.enum(["usd", "credits"]),
  limit: z.number().positive(),
});
export type BudgetConstraint = z.infer<typeof BudgetConstraintSchema>;

export const IntentSchema = z.object({
  schema_version: z.string().regex(/^\d+\.\d+(\.\d+)?$/),
  intent_id: z.string().regex(/^I-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/),
  // rev1 `linear_id`/`target_issue` generalized to a tracker-agnostic pair; the Tracker
  // port fills these in, pattern validation (e.g. GitHub issue URL shape) is the adapter's
  // job, not the schema's.
  tracker_id: z.string().optional(),
  tracker_url: z.string().optional(),
  target_pr: z
    .string()
    .regex(/^[a-z0-9-]+\/[a-z0-9-]+#\d+$/)
    .optional(),
  execution_mode: z.enum(["manual", "semi_auto", "auto"]).default("manual"),
  budget: z.array(BudgetConstraintSchema).default([]),
  estimate_ref: z
    .string()
    .optional()
    .describe("Path to estimate.json (docs/spec/<intent-id>/estimate.json)."),
  baseline_estimate_revision_id: z
    .string()
    .optional()
    .describe("Adopted EstimateRevision.revision_id. lane next etc. only ever read this."),
  // M2 review follow-up (team review, 2026-07-31): "adopt" is an auditable act (either
  // alongside a brand-new revision, or re-pointing to an already-existing one via
  // `lane estimate --adopt <revision-id>`), so *when* it happened needs its own record
  // rather than being inferrable only from baseline_estimate_revision_id's current value.
  baseline_adopted_at: Iso8601Schema.optional().describe(
    "When baseline_estimate_revision_id was last set via adoptBaselineRevision().",
  ),
  intent: z.object({
    business_goal: z.string().min(10),
    user_visible_intent: z.string().min(10),
    success: z.array(z.string()).min(1),
    non_goal: z.array(z.string()).default([]),
    constraints: z.array(z.string()).default([]),
    primary_user: z.string(),
    state_segments: z.array(z.string()).default([]),
    known_affected_behavior: z.array(z.string()).default([]),
    // Renamed from rev1 risk_level. Immutable once written: gates never downgrade it, and
    // no code path in core is allowed to write back to intent.intent.declared_risk. The
    // gate-time effective value lives in LaneState.effective_risk_log instead (§3.4).
    declared_risk: RiskLevelSchema,
  }),
  ai_inferred_scope: z.object({
    affected_layers: z.array(z.string()).min(1),
    related_files: z.array(z.string()).default([]),
    required_docs: z.array(z.string()).default([]),
    confidence: ConfidenceSchema,
    open_questions: z.array(z.string()).default([]),
    allowed_paths: z.array(z.string()).min(1),
    forbidden_paths: z.array(z.string()).default([]),
  }),
});
export type Intent = z.infer<typeof IntentSchema>;
