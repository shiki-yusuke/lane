import type { KnowledgeRecord, KnowledgeRef, KnowledgeTaxonomy } from "@lane/schemas";
import { matchesPathPrefixSegments } from "../glob.js";

// design.md §5.4/§8 — deterministic top-N knowledge injection. This is one of the "v1
// core" items design.md explicitly says must not be cut (§8), and unlike the other
// application services it needs no adapter (knowledge is core's own 1-record-1-file
// store, §2.8), so it is implemented in full here rather than left a skeleton.

export const SCORING_VERSION = "1.0";
const PATH_EXACT_SCORE = 1.0;
const PATH_PREFIX_SCORE = 0.72;
const TAXONOMY_BONUS = 0.05;
export const SCORE_THRESHOLD = 0.7;
export const OVERALL_TOP_N = 3;
export const PER_LENS_MAX = 2;

export interface ScoredKnowledgeMatch {
  record: KnowledgeRecord;
  score: number;
  matchedBy: KnowledgeRef["matched_by"];
}

/**
 * True if `record` is eligible to be considered at all in the context of `repoId`
 * (must-2, Codex M3 review: scoped records were never filtered by repo, so two repos with
 * the same relative path — e.g. both happen to have `src/index.ts` — could leak each
 * other's scoped knowledge into a query). `scope=global` records are always eligible.
 * `scope=scoped` records require an *exact* `repo_id` match; when `repoId` is `null`
 * (couldn't be determined — e.g. no `--repo-id` and no resolvable git remote), no scoped
 * record is eligible at all — excluding is the safe default, never guessing which repo a
 * scoped record might belong to just to show *something*.
 */
export function isKnowledgeRecordInScope(record: KnowledgeRecord, repoId: string | null): boolean {
  if (record.scope === "global") return true;
  return repoId !== null && record.repo_id === repoId;
}

/**
 * Scores one record against the query paths (and, only as a bonus, taxonomies).
 * Returns null if the record has no path/path_prefix match at all — taxonomy alone never
 * qualifies a record on its own (design.md §5.4).
 */
export function scoreKnowledgeRecord(
  record: KnowledgeRecord,
  queryPaths: readonly string[],
  queryTaxonomies: readonly KnowledgeTaxonomy[] = [],
): ScoredKnowledgeMatch | null {
  let score: number | null = null;
  let matchedBy: KnowledgeRef["matched_by"] | null = null;

  if (record.paths.some((p) => queryPaths.includes(p))) {
    score = PATH_EXACT_SCORE;
    matchedBy = "path";
  } else if (
    record.path_prefixes.some((prefix) =>
      queryPaths.some((qp) => matchesPathPrefixSegments(prefix, qp)),
    )
  ) {
    score = PATH_PREFIX_SCORE;
    matchedBy = "path_prefix";
  }
  if (score === null || matchedBy === null) return null;

  const recordTaxonomy = record.type === "review_finding" ? record.taxonomy : null;
  const belowThresholdBeforeBonus = score < SCORE_THRESHOLD;
  if (recordTaxonomy && queryTaxonomies.includes(recordTaxonomy)) {
    score = Math.min(1, score + TAXONOMY_BONUS);
    // Bonus is credited as the deciding factor only when it's what pushed the record over
    // the threshold; otherwise the original path/path_prefix match already explains the score.
    if (belowThresholdBeforeBonus && score >= SCORE_THRESHOLD) {
      matchedBy = "taxonomy_bonus";
    }
  }
  return { record, score, matchedBy };
}

export interface LensKnowledgeQuery {
  lensId: string;
  matches: readonly ScoredKnowledgeMatch[];
}

/**
 * Applies the threshold, then "top 3 overall AND top 2 per lens" cap (design.md §5.4:
 * both conditions, not either). Ties broken by score descending, then record.id for
 * determinism.
 */
export function selectKnowledgeRefs(
  perLens: readonly LensKnowledgeQuery[],
): Map<string, KnowledgeRef[]> {
  type Candidate = { lensId: string; match: ScoredKnowledgeMatch };
  const eligible: Candidate[] = perLens.flatMap((lens) =>
    lens.matches
      .filter((m) => m.score >= SCORE_THRESHOLD)
      .map((match) => ({ lensId: lens.lensId, match })),
  );
  eligible.sort(
    (a, b) => b.match.score - a.match.score || a.match.record.id.localeCompare(b.match.record.id),
  );

  const perLensCount = new Map<string, number>();
  const selected: Candidate[] = [];
  for (const candidate of eligible) {
    if (selected.length >= OVERALL_TOP_N) break;
    const count = perLensCount.get(candidate.lensId) ?? 0;
    if (count >= PER_LENS_MAX) continue;
    selected.push(candidate);
    perLensCount.set(candidate.lensId, count + 1);
  }

  const byLens = new Map<string, KnowledgeRef[]>();
  for (const { lensId, match } of selected) {
    const refs = byLens.get(lensId) ?? [];
    refs.push({
      record_id: match.record.id,
      score: match.score,
      matched_by: match.matchedBy,
      scoring_version: SCORING_VERSION,
    });
    byLens.set(lensId, refs);
  }
  return byLens;
}
