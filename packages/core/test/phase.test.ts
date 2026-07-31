import { describe, expect, it } from "vitest";
import {
  InvalidPhaseTransitionError,
  assertValidTransition,
  isValidTransition,
} from "../src/phase.js";

describe("phase transitions", () => {
  it("allows the documented forward and rework edges", () => {
    expect(isValidTransition("1_intent", "2_spec")).toBe(true);
    expect(isValidTransition("3_implement", "2_spec")).toBe(true);
    expect(isValidTransition("4_verify", "5_done")).toBe(true);
  });

  it("rejects skipping a phase", () => {
    expect(isValidTransition("1_intent", "3_implement")).toBe(false);
  });

  it("5_done is terminal", () => {
    expect(isValidTransition("5_done", "4_verify")).toBe(false);
  });

  it("assertValidTransition throws InvalidPhaseTransitionError on an invalid edge", () => {
    expect(() => assertValidTransition("1_intent", "4_verify")).toThrow(
      InvalidPhaseTransitionError,
    );
  });

  it("assertValidTransition does not throw on a valid edge", () => {
    expect(() => assertValidTransition("2_spec", "3_implement")).not.toThrow();
  });
});
