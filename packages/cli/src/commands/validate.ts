import { loadProfile, recordEffectiveRiskEvaluation, resolveProfilePath } from "@lane/core";
import { readCriticIfExists } from "../critic-store.js";
import { packageDefaultProfilePath } from "../default-profile.js";
import { evaluateBeforePrPublishGates } from "../gate-check.js";
import { intentExists, readIntent } from "../intent-store.js";
import { resolveSpecDir } from "../spec-dir.js";
import { laneStateExists, readLaneState, writeLaneState } from "../state-store.js";
import type { CommandResult } from "./start.js";

export interface ValidateOptions {
  specDir?: string;
  profile?: string;
}

const PR_PUBLISH_PHASES = new Set(["4_verify", "5_done"]);

/**
 * design.md §3.3/§3.4/§10 — validates whatever artifacts exist for the lane so far, and
 * (Codex M1 review, must-3) recomputes+records the profile-driven effective risk before
 * evaluating any gate, so risk_auto_upgrade rules actually affect the outcome instead of
 * being dead config. Exit codes follow the Python reference implementation's convention: 0=pass, 2=lane state
 * error, 3=gate failure.
 *
 * Codex M4 review, must-2: critic.yaml has no CLI-side schema check of its own before this
 * fix, so a malformed one (wrong lens set, `applicable` missing finding/taxonomy, etc.)
 * could pass every gate undetected all the way to 5_done. It's checked here whenever it
 * exists (readCriticIfExists throws, same as readIntent above, if it's malformed) — never
 * required before it's actually written, matching intent.yaml/verification.yaml's own
 * "read-if-exists" convention.
 */
export function runValidate(intentId: string, opts: ValidateOptions): CommandResult {
  const specDir = resolveSpecDir({ override: opts.specDir });

  if (!laneStateExists(specDir, intentId)) {
    return { exitCode: 2, message: `Lane state not found: ${intentId}` };
  }
  if (!intentExists(specDir, intentId)) {
    return { exitCode: 2, message: `intent.yaml not found for ${intentId}` };
  }

  let state = readLaneState(specDir, intentId);
  const intent = readIntent(specDir, intentId); // throws (schema error) if invalid

  const { path: profilePath } = resolveProfilePath({
    explicit: opts.profile,
    cwd: process.cwd(),
    packageDefaultPath: packageDefaultProfilePath(),
  });
  const profile = loadProfile(profilePath);
  const critic = readCriticIfExists(specDir, intentId, profile); // throws if malformed

  // Every validate call is a gate-evaluation event for audit purposes, even for phases
  // where no gate currently applies (design.md §3.4: recomputed "gate 毎に").
  const now = new Date().toISOString();
  state = recordEffectiveRiskEvaluation(state, intent, profile, "spec_consensus", now);
  writeLaneState(specDir, intentId, state);

  if (!PR_PUBLISH_PHASES.has(state.current_phase)) {
    return {
      exitCode: 0,
      message: `intent.yaml is valid${critic ? " and critic.yaml is valid" : ""} (phase=${state.current_phase}; spec_consensus gate is not evaluated before 4_verify).`,
    };
  }

  const result = evaluateBeforePrPublishGates(
    specDir,
    intentId,
    state,
    intent,
    profile,
    state.current_phase,
  );
  if (!result.pass) {
    return { exitCode: 3, message: `Gate failed: ${result.reason}` };
  }
  return {
    exitCode: 0,
    message: "intent.yaml and verification.yaml are valid; all applicable gates pass.",
  };
}
