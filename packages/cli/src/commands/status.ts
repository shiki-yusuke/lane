import { loadStateWithOverlay } from "@lane/core";
import { resolveSpecDir } from "../spec-dir.js";
import { laneStateExists, readLaneState } from "../state-store.js";
import type { CommandResult } from "./start.js";

export interface StatusOptions {
  specDir?: string;
}

export function runStatus(intentId: string, opts: StatusOptions): CommandResult {
  const specDir = resolveSpecDir({ override: opts.specDir });
  if (!laneStateExists(specDir, intentId)) {
    return { exitCode: 2, message: `Lane state not found: ${intentId}` };
  }
  const raw = readLaneState(specDir, intentId);
  const [state, doneSource] = loadStateWithOverlay(specDir, intentId, raw);

  const lines = [
    `intent_id: ${state.intent_id}`,
    `current_phase: ${state.current_phase}`,
    `status: ${state.status}${doneSource === "local_overlay" ? " (via local done overlay)" : ""}`,
    "phase_history:",
    ...state.phase_history.map(
      (ph) =>
        `  - ${ph.phase}: ${ph.result} (started_at=${ph.started_at}${ph.ended_at ? `, ended_at=${ph.ended_at}` : ""})`,
    ),
  ];
  return { exitCode: 0, message: lines.join("\n") };
}
