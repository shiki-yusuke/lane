import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveDataDir } from "@lane/core";

export interface RejectEntry {
  sourcePath: string;
  reason: string;
}

/**
 * Dedicated directory for one-time importer reject reports — deliberately *not* inside
 * calibrationDir()/knowledgeDir(), since those directories are scanned wholesale
 * (`listObservations()`/`listKnowledgeRecords()` parse every *.json file in them as a
 * record) and a stray reject-report.json there would fail that parse.
 */
export function migrationReportsDir(): string {
  return join(resolveDataDir(), "migration-reports");
}

/**
 * design.md §7.1 — the one-time importers must never silently skip a record; every
 * skipped input is listed here with why, so a human can decide whether to fix the source
 * data and re-run rather than quietly losing it.
 *
 * `unmapped` is a distinct, non-empty-by-default list for records that *were* imported
 * successfully but not as their most faithful lane type — e.g. migrate-legacy-knowledge's
 * legacy Type="TODO" rows, which are finding-like but get imported as review_decision
 * because no reliable taxonomy mapping exists (team review requirement: this downgrade
 * must be visible in the report, never a silent count-only loss inside a successful
 * import).
 */
export function writeRejectReport(
  path: string,
  generatedAt: string,
  rejects: readonly RejectEntry[],
  unmapped: readonly RejectEntry[] = [],
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        generated_at: generatedAt,
        count: rejects.length,
        rejects,
        unmapped_count: unmapped.length,
        unmapped,
      },
      null,
      2,
    ),
  );
}
