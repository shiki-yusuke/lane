import { z } from "zod";
import { ConfidenceSchema, Iso8601Schema } from "./common.js";
import { KnowledgeTaxonomySchema } from "./taxonomy.js";

// re-exported so callers of critic.ts can import taxonomy from either module, matching
// design.md's "critic.taxonomy と同一集合を共有" note.
export { KnowledgeTaxonomySchema };
export type { KnowledgeTaxonomy } from "./taxonomy.js";

// design.md §2.8.
export const KnowledgeRefSchema = z.object({
  record_id: z.string(),
  score: z.number(),
  matched_by: z.enum(["path", "path_prefix", "taxonomy_bonus"]),
  scoring_version: z.string(),
});
export type KnowledgeRef = z.infer<typeof KnowledgeRefSchema>;

// design.md §2.8 models this record as base.and(scope).and(discriminatedUnion(type)).
// That reads cleanly but zod-to-json-schema renders each ZodIntersection member as its
// own `additionalProperties: false` object nested in `allOf`; JSON Schema then requires
// every key in the *whole* merged object to appear in *each* branch's own property list,
// which none of them do individually. The result is a generated schema that rejects every
// valid record (verified empirically against ajv while building the differential fixture
// test, §10). Four fully-flattened object variants (still expressing the same 2x2 scope x
// type space) avoid the problem: each variant lists all of its own fields directly, so it
// serializes to one self-contained JSON Schema object instead of an intersection.
const baseFields = {
  schema_version: z.string(),
  id: z.string(),
  source_ref: z.string().optional(),
  confidence: ConfidenceSchema.default("medium"),
  status: z.enum(["active", "superseded"]).default("active"),
  supersedes: z.string().nullable().default(null),
  applicability: z.string().optional(),
  paths: z.array(z.string()).default([]),
  path_prefixes: z.array(z.string()).default([]),
  summary: z.string(),
  detail: z.string().optional(),
  tags: z.array(z.string()).default([]),
  source_intent_id: z.string().optional(),
  created_at: Iso8601Schema,
  provenance: z.enum(["lane", "imported_legacy_memories"]).default("lane"),
};

const globalScopeFields = { scope: z.literal("global") };
// ~/.lane spans multiple repos; a scoped record must say which repo (and optionally which
// profile) it belongs to, so relative `paths`/`path_prefixes` never collide across repos.
const scopedScopeFields = {
  scope: z.literal("scoped"),
  repo_id: z.string(),
  profile_id: z.string().optional(),
};

const findingFields = {
  type: z.literal("review_finding"),
  taxonomy: KnowledgeTaxonomySchema,
  evidence: z.string().min(1),
  resolution: z.enum(["fixed", "wontfix", "deferred"]),
};
const decisionFields = {
  type: z.literal("review_decision"),
  context: z.string().min(1),
  rationale: z.string().min(1),
};

const GlobalFindingSchema = z.object({ ...baseFields, ...globalScopeFields, ...findingFields });
const GlobalDecisionSchema = z.object({ ...baseFields, ...globalScopeFields, ...decisionFields });
const ScopedFindingSchema = z.object({ ...baseFields, ...scopedScopeFields, ...findingFields });
const ScopedDecisionSchema = z.object({ ...baseFields, ...scopedScopeFields, ...decisionFields });

export const KnowledgeRecordSchema = z
  .union([GlobalFindingSchema, GlobalDecisionSchema, ScopedFindingSchema, ScopedDecisionSchema])
  .refine((r) => r.scope === "global" || r.paths.length > 0 || r.path_prefixes.length > 0, {
    message: "a record with no paths/path_prefixes must explicitly declare scope=global",
  });
export type KnowledgeRecord = z.infer<typeof KnowledgeRecordSchema>;
