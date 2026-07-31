import { z } from "zod";

// design.md §2.1 — PHASE_ORDER / PhaseSchema live in schemas (the dependency-free bottom
// layer) so that core does not need to be imported by schemas. core/phase.ts consumes
// PHASE_TRANSITIONS for its pure transition-check functions but the transition table
// itself is defined here, next to Phase, so the two never drift apart.
export const PHASE_ORDER = ["1_intent", "2_spec", "3_implement", "4_verify", "5_done"] as const;

export const PhaseSchema = z.enum(PHASE_ORDER);
export type Phase = (typeof PHASE_ORDER)[number];

// Mirrors the Python reference implementation orchestrator.py VALID_TRANSITIONS (cmd_advance, orchestrator.py:1963-1969)
// exactly: same forward path, same two backward (re-entry) edges, 5_done terminal.
export const PHASE_TRANSITIONS: Record<Phase, readonly Phase[]> = {
  "1_intent": ["2_spec"],
  "2_spec": ["3_implement", "1_intent"],
  "3_implement": ["4_verify", "2_spec"],
  "4_verify": ["5_done", "3_implement"],
  "5_done": [],
};
