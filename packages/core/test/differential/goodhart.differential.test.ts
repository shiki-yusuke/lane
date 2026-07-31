import { describe, expect, it } from "vitest";
import { validateNoPersonalDimensions } from "../../src/goodhart.js";
import { callPython, isPythonReferenceAvailable } from "./python-harness.js";

// M4 — skips gracefully without the private Python reference implementation installed
// locally (see python-harness.ts's isPythonReferenceAvailable doc comment).
const describeOrSkip = isPythonReferenceAvailable() ? describe : describe.skip;

describeOrSkip(
  "validateNoPersonalDimensions matches the Python reference implementation's validate_no_personal_dimensions",
  () => {
    const payloads: unknown[] = [
      { author: "someone", lane_id: "L1" },
      { lane_id: "L1", phase: "2_spec", nested: { reviewer: "someone" } },
      [{ assignee: "x" }, { email: "y@example.com" }],
      { lane_id: "L1", model_routing: { model: "claude", user_id: "u1" } },
      { lane_id: "L1", phase: "2_spec", source: "manual" }, // no violations
    ];
    for (const [i, payload] of payloads.entries()) {
      it(`payload #${i}`, () => {
        const expected = callPython<string[]>("validate_no_personal_dimensions", [payload]);
        const actual = validateNoPersonalDimensions(payload);
        expect([...actual].sort()).toEqual([...expected].sort());
      });
    }
  },
);
