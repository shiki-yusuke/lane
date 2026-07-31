import { PHASE_ORDER, PHASE_TRANSITIONS, type Phase } from "@lane/schemas";

// design.md §2.1/§3 — PHASE_TRANSITIONS itself lives in schemas (the dependency-free
// layer); this module only holds the pure functions that consume it, ported from
// the Python reference implementation orchestrator.py's cmd_advance VALID_TRANSITIONS check (lines 1963-1976) and
// is_forward_transition (lines 707-712).

export function validNextPhases(current: Phase): readonly Phase[] {
  return PHASE_TRANSITIONS[current];
}

export function isValidTransition(current: Phase, target: Phase): boolean {
  return PHASE_TRANSITIONS[current].includes(target);
}

/** Phase order position (index into PHASE_ORDER) as forward/backward is defined by. */
export function isForwardTransition(current: Phase, target: Phase): boolean {
  const from = PHASE_ORDER.indexOf(current);
  const to = PHASE_ORDER.indexOf(target);
  if (from === -1 || to === -1) return false;
  return to > from;
}

export class InvalidPhaseTransitionError extends Error {
  constructor(
    readonly current: Phase,
    readonly target: Phase,
  ) {
    super(
      `Invalid transition: ${current} -> ${target} (valid next phases from ${current}: ${PHASE_TRANSITIONS[current].join(", ") || "none"})`,
    );
    this.name = "InvalidPhaseTransitionError";
  }
}

/** Throws InvalidPhaseTransitionError if the transition is not in PHASE_TRANSITIONS. */
export function assertValidTransition(current: Phase, target: Phase): void {
  if (!isValidTransition(current, target)) {
    throw new InvalidPhaseTransitionError(current, target);
  }
}
