import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildKnowledgeRecordFromLegacyMemory } from "@lane/core";
import { writeKnowledgeRecord } from "../knowledge-store.js";
import { type RejectEntry, migrationReportsDir, writeRejectReport } from "../reject-report.js";
import type { CommandResult } from "./start.js";

export interface MigrateLegacyKnowledgeOptions {
  /** Path to the legacy memory export: one JSON object per line (JSONL). */
  input: string;
  /** Scopes every imported record (design.md §2.8 KnowledgeScope) — one importer run per source repo. */
  repoId: string;
  rejectReportPath?: string;
}

/**
 * `lane migrate-legacy-knowledge --input <path> --repo-id <owner/repo>` — one-time importer
 * (design.md §7.1/§8). See core/migrate-legacy-knowledge.ts for the legacy Type -> lane
 * KnowledgeRecord.type mapping and why review_finding migration is out of scope for v1.
 */
export function runMigrateLegacyKnowledge(opts: MigrateLegacyKnowledgeOptions): CommandResult {
  if (!existsSync(opts.input)) {
    return { exitCode: 1, message: `--input file not found: ${opts.input}` };
  }
  if (!opts.repoId) {
    return { exitCode: 1, message: "--repo-id is required" };
  }

  const lines = readFileSync(opts.input, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  const rejects: RejectEntry[] = [];
  // Legacy Type="TODO" rows are finding-like but imported as review_decision (no reliable
  // taxonomy mapping — see core/migrate-legacy-knowledge.ts). Tracked here, separately from
  // `rejects`, so the downgrade is a visible count in the report rather than a silent
  // side-effect of a "successful" import (team review requirement, 2026-07-31).
  const unmapped: RejectEntry[] = [];
  let imported = 0;
  const now = new Date().toISOString();

  lines.forEach((line, i) => {
    const sourceRef = `${opts.input}:${i + 1}`;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      rejects.push({
        sourcePath: sourceRef,
        reason: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }
    const result = buildKnowledgeRecordFromLegacyMemory(raw, opts.repoId);
    if ("reject" in result) {
      rejects.push({ sourcePath: sourceRef, reason: result.reject });
      return;
    }
    writeKnowledgeRecord(result.record);
    imported++;
    if (result.downgradedFromFindingLike) {
      unmapped.push({
        sourcePath: sourceRef,
        reason:
          "legacy Type=TODO is review_finding-equivalent but has no reliable taxonomy mapping; imported as review_decision instead (design.md §7.1)",
      });
    }
  });

  const rejectReportPath =
    opts.rejectReportPath ?? join(migrationReportsDir(), "legacy-knowledge-reject-report.json");
  writeRejectReport(rejectReportPath, now, rejects, unmapped);

  return {
    exitCode: 0,
    message: [
      `imported ${imported} knowledge record(s) from ${lines.length} line(s); rejected ${rejects.length}, ${unmapped.length} downgraded from review_finding-equivalent (see ${rejectReportPath})`,
      // should-7 (M2 review, 2026-07-31): imported records may carry internal references
      // (PR URLs, ticket-shaped text) from the source export. provenance="imported_legacy_memories"
      // is the one mechanical key that lets a public/OSS export step exclude this data
      // (design.md §7.1) — this warning exists so that fact isn't only discoverable by
      // reading the design doc after the fact.
      "note: imported records may contain internal references (PR URLs, ticket IDs, etc.) carried over from the source export; never publish the knowledge data dir as-is.",
    ].join("\n"),
  };
}
