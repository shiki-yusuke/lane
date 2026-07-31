import { randomUUID } from "node:crypto";
import {
  type LensKnowledgeQuery,
  SCORING_VERSION,
  isKnowledgeRecordInScope,
  scoreKnowledgeRecord,
  selectKnowledgeRefs,
} from "@lane/core";
import type { Confidence, KnowledgeRecord, KnowledgeTaxonomy } from "@lane/schemas";
import { KnowledgeRecordSchema } from "@lane/schemas";
import { deriveRepoIdFromGitRemote } from "../git-info.js";
import { listKnowledgeRecords, writeKnowledgeRecord } from "../knowledge-store.js";
import type { CommandResult } from "./start.js";

export interface KnowledgeAppendOptions {
  id?: string;
  type: "review_finding" | "review_decision";
  scope: "global" | "scoped";
  repoId?: string;
  profileId?: string;
  summary: string;
  detail?: string;
  paths?: string[];
  pathPrefixes?: string[];
  tags?: string[];
  sourceRef?: string;
  sourceIntentId?: string;
  confidence?: Confidence;
  // review_finding only
  taxonomy?: KnowledgeTaxonomy;
  evidence?: string;
  resolution?: "fixed" | "wontfix" | "deferred";
  // review_decision only
  context?: string;
  rationale?: string;
}

/**
 * `lane knowledge append` (design.md §2.8/§5.4) — one CLI-driven record per invocation,
 * matching the store's 1-record-1-file convention. `--scope global` requires no paths (a
 * cross-repo lesson); `--scope scoped` requires --repo-id (design's KnowledgeScope: a
 * scoped record must say which repo it belongs to since ~/.lane spans multiple repos).
 */
export function runKnowledgeAppend(opts: KnowledgeAppendOptions): CommandResult {
  if (opts.scope === "scoped" && !opts.repoId) {
    return { exitCode: 1, message: "--repo-id is required when --scope scoped" };
  }
  if (opts.type === "review_finding" && (!opts.taxonomy || !opts.evidence || !opts.resolution)) {
    return {
      exitCode: 1,
      message: "--taxonomy, --evidence, and --resolution are required for --type review_finding",
    };
  }
  if (opts.type === "review_decision" && (!opts.context || !opts.rationale)) {
    return {
      exitCode: 1,
      message: "--context and --rationale are required for --type review_decision",
    };
  }

  const id = opts.id ?? `k-${randomUUID()}`;
  const base = {
    schema_version: "1.0",
    id,
    source_ref: opts.sourceRef,
    confidence: opts.confidence ?? "medium",
    status: "active" as const,
    supersedes: null,
    paths: opts.paths ?? [],
    path_prefixes: opts.pathPrefixes ?? [],
    summary: opts.summary,
    detail: opts.detail,
    tags: opts.tags ?? [],
    source_intent_id: opts.sourceIntentId,
    created_at: new Date().toISOString(),
    provenance: "lane" as const,
  };

  let record: KnowledgeRecord;
  if (opts.scope === "scoped") {
    record = KnowledgeRecordSchema.parse({
      ...base,
      scope: "scoped",
      repo_id: opts.repoId,
      profile_id: opts.profileId,
      ...(opts.type === "review_finding"
        ? {
            type: "review_finding",
            taxonomy: opts.taxonomy,
            evidence: opts.evidence,
            resolution: opts.resolution,
          }
        : { type: "review_decision", context: opts.context, rationale: opts.rationale }),
    });
  } else {
    record = KnowledgeRecordSchema.parse({
      ...base,
      scope: "global",
      ...(opts.type === "review_finding"
        ? {
            type: "review_finding",
            taxonomy: opts.taxonomy,
            evidence: opts.evidence,
            resolution: opts.resolution,
          }
        : { type: "review_decision", context: opts.context, rationale: opts.rationale }),
    });
  }

  writeKnowledgeRecord(record);
  return { exitCode: 0, message: `appended knowledge record ${id}` };
}

export interface KnowledgeQueryOptions {
  paths: string[];
  taxonomy?: KnowledgeTaxonomy[];
  /**
   * Scopes which `scope=scoped` records are eligible (must-2, Codex M3 review).
   * `undefined` (the default): derive from `deriveRepoIdFromGitRemote(process.cwd())`.
   * A string: use it as-is (`--repo-id` override). `null`: force "repo context
   * undeterminable" explicitly (mainly for tests — a real CLI invocation never produces
   * `null` itself, only `undefined`). Whenever no repo id resolves, every scoped record is
   * excluded (never guessed) and a warning line is printed.
   */
  repoId?: string | null;
  /**
   * When given, also computes the threshold+top-3(overall)/top-2(per-lens) selection
   * (core/application/knowledge-service.ts's selectKnowledgeRefs) as if this lens were the
   * only one querying — i.e. the true cross-lens "3 total across the whole critic.yaml"
   * arbitration needs every lens's candidates considered together, which a single `lane
   * knowledge query` invocation cannot see. This preview instead applies the per-lens cap
   * (max 2) alone, which is the binding constraint when a lens is queried in isolation; a
   * human/skill assembling critic.yaml across multiple per-lens queries is responsible for
   * the final "no more than 3 distinct records selected across the whole file" check.
   */
  lensId?: string;
}

/**
 * `lane knowledge query --paths <p> [<p>...] [--taxonomy <t>...] [--lens <id>]`
 * (design.md §5.4) — prints every scored match (>0, i.e. any path/path_prefix hit at all)
 * in the design.md example's human-readable format, plus a `knowledge_candidates` JSON
 * array (KnowledgeRefSchema[]) that pastes directly into a critic.yaml
 * per_lens[].knowledge_candidates entry (design's own field: "query で提示された候補（引用した
 * かは問わない）" — the raw output of this command, before the top-3/top-2 citation cap).
 * When --lens is given, also prints the capped `knowledge_refs` preview for that lens.
 */
export function runKnowledgeQuery(opts: KnowledgeQueryOptions): CommandResult {
  if (opts.paths.length === 0) {
    return { exitCode: 1, message: "at least one --paths is required" };
  }

  const repoId = opts.repoId === undefined ? deriveRepoIdFromGitRemote(process.cwd()) : opts.repoId;
  const allRecords = listKnowledgeRecords();
  const totalScopedCount = allRecords.filter((r) => r.scope === "scoped").length;
  const records = allRecords.filter((r) => isKnowledgeRecordInScope(r, repoId));
  const excludedScopedCount = totalScopedCount - records.filter((r) => r.scope === "scoped").length;

  const matches = records
    .map((record) => scoreKnowledgeRecord(record, opts.paths, opts.taxonomy ?? []))
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id));

  const lines: string[] = [];
  if (repoId === null && totalScopedCount > 0) {
    lines.push(
      `warning: could not determine repo context (no --repo-id, no resolvable git remote) — excluding ${totalScopedCount} scope=scoped record(s); pass --repo-id explicitly to include them`,
    );
  } else if (excludedScopedCount > 0) {
    lines.push(
      `note: excluded ${excludedScopedCount} scope=scoped record(s) belonging to a different repo_id than "${repoId}"`,
    );
  }
  if (matches.length === 0) {
    lines.push("(no matching knowledge records)");
  }
  for (const m of matches) {
    const matchLabel =
      m.matchedBy === "path"
        ? "path match"
        : m.matchedBy === "path_prefix"
          ? "path_prefix match"
          : "taxonomy bonus";
    const typeLabel = m.record.type === "review_finding" ? "review_finding" : "review_decision";
    const detail =
      m.record.type === "review_finding"
        ? `${m.record.summary} (taxonomy: ${m.record.taxonomy})`
        : m.record.summary;
    lines.push(`score=${m.score.toFixed(2)}  ${matchLabel.padEnd(16)}[${typeLabel}] ${detail}`);
  }

  const knowledgeCandidates = matches.map((m) => ({
    record_id: m.record.id,
    score: m.score,
    matched_by: m.matchedBy,
    scoring_version: SCORING_VERSION,
  }));
  lines.push("", "knowledge_candidates (paste into critic.yaml per_lens[].knowledge_candidates):");
  lines.push(JSON.stringify(knowledgeCandidates, null, 2));

  if (opts.lensId) {
    const lensQuery: LensKnowledgeQuery = { lensId: opts.lensId, matches };
    const byLens = selectKnowledgeRefs([lensQuery]);
    const refs = byLens.get(opts.lensId) ?? [];
    lines.push(
      "",
      `knowledge_refs preview for lens "${opts.lensId}" (per-lens cap only; final cross-lens top-3 arbitration is the critic author's responsibility):`,
    );
    lines.push(JSON.stringify(refs, null, 2));
  }

  return { exitCode: 0, message: lines.join("\n") };
}
