import { z } from "zod";
import { ConfidenceSchema, RiskLevelSchema } from "./common.js";
import { KnowledgeRefSchema } from "./knowledge.js";
import type { Profile } from "./profile.js";
import { KnowledgeTaxonomySchema } from "./taxonomy.js";

// the Python reference implementation's 9 core lenses (critic.schema.json / orchestrator design notes), kept as a
// constant rather than re-derived so buildCriticSchema()'s allow-list is stable.
export const CORE_9_LENSES = [
  "lifecycle_management",
  "error_handling",
  "security",
  "performance",
  "a11y",
  "i18n",
  "architecture",
  "test_coverage",
  "documentation",
] as const;

export const HaltTriggerSchema = z.object({
  condition: z.string(),
  triggered: z.boolean(),
  evidence: z.string().optional(),
});
export type HaltTrigger = z.infer<typeof HaltTriggerSchema>;

export const MissingScenarioSchema = z.object({
  taxonomy: KnowledgeTaxonomySchema,
  title: z.string(),
  suggested_gherkin: z.string().optional(),
});
export type MissingScenario = z.infer<typeof MissingScenarioSchema>;

// design.md §2.3 — rev1 only had the result enum with no cross-field validation; the
// refines below are the sol-reviewed fix (result=applicable needs finding+taxonomy,
// result=unknown needs open_question).
export const PerLensSchema = z
  .object({
    lens_id: z.string(),
    result: z.enum(["applicable", "not_applicable", "unknown"]),
    finding: z.string().nullable().default(null),
    taxonomy: KnowledgeTaxonomySchema.nullable().default(null),
    open_question: z.string().nullable().default(null),
    evidence: z.string().nullable().default(null),
    knowledge_candidates: z
      .array(KnowledgeRefSchema)
      .default([])
      .describe("Candidates surfaced by lane knowledge query, whether cited or not."),
    knowledge_refs: z
      .array(KnowledgeRefSchema)
      .default([])
      .describe(
        "Subset of knowledge_candidates actually cited as evidence for finding/open_question.",
      ),
  })
  .refine((l) => l.result !== "applicable" || (!!l.finding && !!l.taxonomy), {
    message: "result=applicable requires both finding and taxonomy",
  })
  .refine((l) => l.result !== "unknown" || !!l.open_question, {
    message: "result=unknown requires open_question",
  });
export type PerLens = z.infer<typeof PerLensSchema>;

/**
 * Builds a Critic schema scoped to a profile's lens allow-list (CORE_9_LENSES plus at
 * most the profile's first 3 extra_lenses). A factory rather than a static export because
 * the allow-list depends on the profile passed at validation time (design.md §2.3).
 */
export function buildCriticSchema(profile: Profile) {
  const allowedLensIds = new Set<string>([...CORE_9_LENSES, ...profile.extra_lenses.slice(0, 3)]);
  return z
    .object({
      schema_version: z.string(),
      intent_id: z.string(),
      risk_class: RiskLevelSchema.optional(),
      decision: z.enum(["pass", "needs_revision", "blocked"]),
      confidence: ConfidenceSchema,
      per_lens: z.array(PerLensSchema).min(1),
      halt_triggers: z.array(HaltTriggerSchema).default([]),
      missing_scenarios: z.array(MissingScenarioSchema).default([]),
      wrong_assumptions: z.array(z.string()).default([]),
      open_questions: z.array(z.string()).default([]),
      required_actions: z.array(z.string()).default([]),
    })
    .refine(
      (c) => {
        const ids = c.per_lens.map((l) => l.lens_id);
        return new Set(ids).size === ids.length;
      },
      { message: "per_lens.lens_id must not contain duplicates" },
    )
    .refine((c) => c.per_lens.every((l) => allowedLensIds.has(l.lens_id)), {
      message: "lens_id must be one of core 9 lenses + at most 3 profile extra_lenses",
    })
    .refine((c) => c.decision !== "blocked" || c.halt_triggers.some((h) => h.triggered), {
      message: "decision=blocked requires at least one halt_trigger with triggered=true",
    })
    .refine((c) => c.halt_triggers.every((h) => !h.triggered) || c.decision === "blocked", {
      message: "a triggered halt_trigger requires decision=blocked",
    });
}
export type Critic = z.infer<ReturnType<typeof buildCriticSchema>>;
