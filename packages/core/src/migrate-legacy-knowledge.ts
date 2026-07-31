import { type KnowledgeRecord, KnowledgeRecordSchema } from "@lane/schemas";
import { z } from "zod";

// design.md §7.1/M2 item 5 — one-time importer, knowledge side. Built against the real
// row shape found in the salvaged review-memory export (a flattened Notion database
// export: one JSON object per line, keyed by the database's column names) inspected
// during M2 implementation — not against design.md's original hypothetical
// `memories.jsonl` shape, which doesn't correspond to any file that actually exists in
// the archive.
//
// **Legacy value mapping (team review requirement)**: the export's `Type` column has 4
// real values (review_decision / TODO / spec_context / review_defer). All four are
// imported as KnowledgeRecord.type="review_decision", never "review_finding" —
// review_finding requires a `taxonomy` from lane's fixed 10-value enum (§2.8), and no
// reliable mapping exists from the export's free-text `Tags` column onto that enum: of a
// representative sample, tags like "performance"/"memoization"/"css" don't correspond to
// any of missing_state/wrong_assumption/too_implementation_specific/test_missing/
// architecture_violation/compatibility_missed/context_variant_missed/lifecycle_missed/
// scope_ambiguity/observability_gap. Fabricating a taxonomy the source data doesn't
// support would misrepresent import confidence, so review_finding migration is left out
// of this v1 pass; every record is a review_decision instead, with the original `Type`
// preserved as a prefix in `context` for traceability.
const LEGACY_TYPE_LABEL: Record<string, string> = {
  review_decision: "Review decision",
  TODO: "TODO (unresolved at export time)",
  spec_context: "Spec context",
  review_defer: "Deferred",
};

const LegacyMemoryRowSchema = z
  .object({
    "Memory ID": z.string(),
    Type: z.string().nullable().optional(),
    Summary: z.string().nullable().optional(),
    Detail: z.string().nullable().optional(),
    Files: z.string().nullable().optional(),
    Tags: z.string().nullable().optional(),
    "date:Created:start": z.string().nullable().optional(),
    "PR URL": z.string().nullable().optional(),
  })
  .passthrough();

export interface MigrateKnowledgeSuccess {
  record: KnowledgeRecord;
  /**
   * true when the legacy Type ("TODO") indicates this was an actionable finding, not a
   * decision/context note — the closest legacy analog to lane's review_finding. Still
   * imported successfully as review_decision (team review, 2026-07-31: never fabricate a
   * taxonomy), but the caller must count these separately in the reject-report so the
   * "downgrade" is visible, not a silent loss of information (team review follow-up:
   * "review_finding 相当は unmapped として件数記録").
   */
  downgradedFromFindingLike: boolean;
}
export interface MigrateKnowledgeReject {
  reject: string;
}

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function parsePaths(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * `repoId` scopes every record imported from this batch (design's KnowledgeScope
 * requires one repo_id per scoped record, but the legacy export doesn't reliably carry a
 * single-repo identifier per row) — one importer run per source repo.
 */
export function buildKnowledgeRecordFromLegacyMemory(
  raw: unknown,
  repoId: string,
): MigrateKnowledgeSuccess | MigrateKnowledgeReject {
  const parsed = LegacyMemoryRowSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      reject: `does not match the expected legacy memory row shape: ${parsed.error.message}`,
    };
  }
  const row = parsed.data;

  const type = row.Type;
  if (!type || !(type in LEGACY_TYPE_LABEL)) {
    return { reject: `unrecognized or missing Type: ${type ?? "(none)"}` };
  }
  if (!row.Summary) {
    return { reject: "missing Summary" };
  }

  const paths = parsePaths(row.Files);
  const tags = parseTags(row.Tags);
  const createdDate = row["date:Created:start"];
  // legacy export stores a date only ("2026-03-13"), not a full timestamp; Iso8601Schema
  // requires one, so a nominal time-of-day is appended. JST matches the Python reference implementation's own
  // now_iso() convention (orchestrator.py).
  const createdAt = createdDate ? `${createdDate}T00:00:00+09:00` : new Date().toISOString();

  const record = KnowledgeRecordSchema.parse({
    schema_version: "1.0",
    id: row["Memory ID"],
    source_ref: row["PR URL"] ?? undefined,
    confidence: "medium",
    status: "active",
    paths,
    path_prefixes: [],
    summary: row.Summary,
    detail: row.Detail ?? undefined,
    tags,
    created_at: createdAt,
    provenance: "imported_legacy_memories",
    ...(paths.length > 0 ? { scope: "scoped", repo_id: repoId } : { scope: "global" }),
    type: "review_decision",
    context: `${LEGACY_TYPE_LABEL[type]}: ${row.Summary}`,
    rationale: row.Detail || "No rationale recorded in the legacy memory export.",
  });

  return { record, downgradedFromFindingLike: type === "TODO" };
}
