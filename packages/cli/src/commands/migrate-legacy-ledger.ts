import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildObservationFromLegacyLaneState, computeDigest } from "@lane/core";
import { parse as parseYaml } from "yaml";
import { writeCalibrationRecord } from "../calibration-store.js";
import { type RejectEntry, migrationReportsDir, writeRejectReport } from "../reject-report.js";
import type { CommandResult } from "./start.js";

export interface MigrateLegacyLedgerOptions {
  /** Paths to legacy lane-state.json files. Shell-expand globs before passing (design.md §7.1's own example already assumes this). */
  input: string[];
  rejectReportPath?: string;
}

/**
 * `lane migrate-legacy-ledger --input <path> [--input <path> ...]` — one-time importer
 * (design.md §7.1/§8: not a general migration framework, run once per salvage batch).
 * For each lane-state.json, looks for a sibling intent.yaml in the same directory to
 * improve predictor quality; its absence is not fatal.
 */
export function runMigrateLegacyLedger(opts: MigrateLegacyLedgerOptions): CommandResult {
  if (opts.input.length === 0) {
    return { exitCode: 1, message: "--input <path-to-lane-state.json> is required (repeatable)" };
  }

  const rejects: RejectEntry[] = [];
  let imported = 0;
  const now = new Date().toISOString();

  for (const path of opts.input) {
    if (!existsSync(path)) {
      rejects.push({ sourcePath: path, reason: "file not found" });
      continue;
    }
    let rawLaneState: unknown;
    try {
      rawLaneState = JSON.parse(readFileSync(path, "utf-8"));
    } catch (err) {
      rejects.push({
        sourcePath: path,
        reason: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    let rawIntent: unknown;
    const intentPath = join(dirname(path), "intent.yaml");
    if (existsSync(intentPath)) {
      try {
        rawIntent = parseYaml(readFileSync(intentPath, "utf-8"));
      } catch {
        // a broken sibling intent.yaml just means lower predictor_quality below, not a hard reject for the ledger data itself
      }
    }

    // deterministic record_id (hash of source path) so re-running the importer on the
    // same input set is idempotent, matching calibrate's own convention.
    const recordId = `cal-legacy-${computeDigest(path).slice(0, 16)}`;
    const result = buildObservationFromLegacyLaneState(rawLaneState, rawIntent, recordId, now);
    if ("reject" in result) {
      rejects.push({ sourcePath: path, reason: result.reject });
      continue;
    }
    writeCalibrationRecord(result.observation);
    imported++;
    // must-4 (M2 review, 2026-07-31): entries within this successful lane-state.json that
    // were themselves excluded (e.g. an older ledger entry shape) still get their own
    // reject-report line — the lane's overall import succeeding must never make those
    // per-entry exclusions invisible.
    for (const entryReject of result.entryRejects) {
      rejects.push({ sourcePath: path, reason: entryReject });
    }
  }

  const rejectReportPath =
    opts.rejectReportPath ?? join(migrationReportsDir(), "legacy-ledger-reject-report.json");
  writeRejectReport(rejectReportPath, now, rejects);

  return {
    exitCode: 0,
    message: `imported ${imported} observation(s) from ${opts.input.length} input file(s); rejected ${rejects.length} (see ${rejectReportPath})`,
  };
}
