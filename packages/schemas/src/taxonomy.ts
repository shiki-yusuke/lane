import { z } from "zod";

// design.md §2.8 — shared between critic.per_lens.taxonomy and knowledge records, so it
// lives in its own module rather than inside either critic.ts or knowledge.ts to avoid
// making one schema file depend on the other for a single enum.
export const KnowledgeTaxonomySchema = z.enum([
  "missing_state",
  "wrong_assumption",
  "too_implementation_specific",
  "test_missing",
  "architecture_violation",
  "compatibility_missed",
  "context_variant_missed",
  "lifecycle_missed",
  "scope_ambiguity",
  "observability_gap",
]);
export type KnowledgeTaxonomy = z.infer<typeof KnowledgeTaxonomySchema>;
