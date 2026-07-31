import { PHASE_ORDER, PHASE_TRANSITIONS, type Phase } from "@lane/schemas";
import { describe, expect, it } from "vitest";
import { isForwardTransition, isValidTransition } from "../../src/phase.js";
import { callPython, isPythonReferenceAvailable } from "./python-harness.js";

// M4 — skips gracefully without the private Python reference implementation installed
// locally (see python-harness.ts's isPythonReferenceAvailable doc comment).
const describeOrSkip = isPythonReferenceAvailable() ? describe : describe.skip;

describeOrSkip(
  "isForwardTransition matches the Python reference implementation's is_forward_transition",
  () => {
    const phases: Phase[] = [...PHASE_ORDER];
    for (const current of phases) {
      for (const target of phases) {
        it(`(${current}, ${target})`, () => {
          const expected = callPython<boolean>("is_forward_transition", [current, target]);
          expect(isForwardTransition(current, target)).toBe(expected);
        });
      }
    }
  },
);

// orchestrator.py's VALID_TRANSITIONS (cmd_advance, lines 1963-1969) is a literal dict
// inside a function, not an exported name callPython can reach — copied here verbatim so
// PHASE_TRANSITIONS (schemas/src/phase.ts) can be checked against it directly.
const REFERENCE_VALID_TRANSITIONS: Record<string, string[]> = {
  "1_intent": ["2_spec"],
  "2_spec": ["3_implement", "1_intent"],
  "3_implement": ["4_verify", "2_spec"],
  "4_verify": ["5_done", "3_implement"],
  "5_done": [],
};

describeOrSkip(
  "PHASE_TRANSITIONS matches the Python reference implementation's orchestrator.py VALID_TRANSITIONS",
  () => {
    it("has the exact same phases and edges", () => {
      expect(PHASE_TRANSITIONS).toEqual(REFERENCE_VALID_TRANSITIONS);
    });

    it("isValidTransition agrees with VALID_TRANSITIONS membership for every (current, target) pair", () => {
      const phases: Phase[] = [...PHASE_ORDER];
      for (const current of phases) {
        for (const target of phases) {
          const expected = REFERENCE_VALID_TRANSITIONS[current]?.includes(target) ?? false;
          expect(isValidTransition(current, target)).toBe(expected);
        }
      }
    });
  },
);
