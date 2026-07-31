import {
  createDoneOverlay,
  isDoneOverlayGuarded,
  isValidTransition,
  loadProfile,
  readDoneOverlay,
  recordEffectiveRiskEvaluation,
  resolveProfilePath,
} from "@lane/core";
import type { Phase } from "@lane/schemas";
import { packageDefaultProfilePath } from "../default-profile.js";
import { evaluateBeforePrPublishGates } from "../gate-check.js";
import { readIntent } from "../intent-store.js";
import { resolveSpecDir } from "../spec-dir.js";
import { laneStateExists, readLaneState, writeLaneState } from "../state-store.js";
import type { CommandResult } from "./start.js";

export interface AdvanceOptions {
  specDir?: string;
  profile?: string;
  prUrl?: string;
  mergeSha?: string;
  toolVersion?: string;
  /** ISO 8601 timestamp of when the PR actually merged. Required for --phase 5_done. */
  mergedAt?: string;
}

/**
 * Phase transition (design.md §3.3/§3.6). Any transition — forward or the two documented
 * rework edges — closes the current in_progress phase_history entry and opens a new one
 * for the target phase. `--phase 5_done` never touches lane-state.json's current_phase:
 * it writes a done overlay instead (design.md §3.6 "merge itself is the done signal"),
 * matching the Python reference implementation's v0.2.0 behavior — but (Codex M1 review, must-1) only *after* the
 * spec_consensus gate passes, using the same profile-driven effective-risk wiring as
 * validate (must-3). Reaching 5_done without ever running the gate used to be possible by
 * simply calling `advance --phase 5_done`, which defeated the entire point of the gate.
 */
export function runAdvance(
  intentId: string,
  targetPhase: Phase,
  opts: AdvanceOptions,
): CommandResult {
  const specDir = resolveSpecDir({ override: opts.specDir });

  if (!laneStateExists(specDir, intentId)) {
    return { exitCode: 2, message: `Lane state not found: ${intentId}` };
  }
  const state = readLaneState(specDir, intentId);
  const current = state.current_phase;

  if (isDoneOverlayGuarded(specDir, intentId, state)) {
    const overlay = readDoneOverlay(specDir, intentId);
    return {
      exitCode: 2,
      message: `Lane is already 5_done (local overlay: ${overlay?.done_recorded_at})`,
    };
  }

  if (!isValidTransition(current, targetPhase)) {
    return {
      exitCode: 2,
      message: `Invalid transition: ${current} -> ${targetPhase}`,
    };
  }

  if (targetPhase === "5_done") {
    if (current !== "4_verify") {
      return {
        exitCode: 2,
        message: `5_done can only be reached from 4_verify (current: ${current})`,
      };
    }
    // orchestrator.py's finish flow (~line 2065) always takes the real PR merge time as
    // an explicit input rather than defaulting to "now" — cycle time must reflect when
    // the PR actually merged, not whenever someone happened to run this command.
    if (!opts.mergedAt) {
      return {
        exitCode: 1,
        message: "--merged-at <ISO 8601 timestamp> is required when advancing to 5_done",
      };
    }

    const intent = readIntent(specDir, intentId);
    const { path: profilePath } = resolveProfilePath({
      explicit: opts.profile,
      cwd: process.cwd(),
      packageDefaultPath: packageDefaultProfilePath(),
    });
    const profile = loadProfile(profilePath);

    const now = new Date().toISOString();
    const stateWithRisk = recordEffectiveRiskEvaluation(
      state,
      intent,
      profile,
      "spec_consensus",
      now,
    );

    const gateResult = evaluateBeforePrPublishGates(
      specDir,
      intentId,
      stateWithRisk,
      intent,
      profile,
      "5_done",
    );
    if (!gateResult.pass) {
      // The risk evaluation above is still a real audit record even though 5_done itself
      // is blocked, so persist it — but do not create the done overlay.
      writeLaneState(specDir, intentId, stateWithRisk);
      return { exitCode: 3, message: `Gate failed: ${gateResult.reason}` };
    }

    createDoneOverlay({
      specDir,
      intentId,
      state: stateWithRisk,
      verifyEndedAt: opts.mergedAt,
      prUrl: opts.prUrl,
      mergeSha: opts.mergeSha ?? null,
      toolVersion: opts.toolVersion ?? "0.1.0",
    });
    writeLaneState(specDir, intentId, stateWithRisk);
    return { exitCode: 0, message: `Recorded 5_done via local overlay for ${intentId}` };
  }

  const now = new Date().toISOString();
  const phaseHistory = state.phase_history.map((ph) =>
    ph.phase === current && ph.result === "in_progress"
      ? { ...ph, ended_at: now, result: "completed" as const }
      : ph,
  );
  phaseHistory.push({ phase: targetPhase, started_at: now, result: "in_progress", retry_count: 0 });

  writeLaneState(specDir, intentId, {
    ...state,
    current_phase: targetPhase,
    status: "running",
    updated_at: now,
    phase_history: phaseHistory,
  });

  return { exitCode: 0, message: `Advanced ${intentId}: ${current} -> ${targetPhase}` };
}
