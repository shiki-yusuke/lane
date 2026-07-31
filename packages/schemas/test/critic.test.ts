import { describe, expect, it } from "vitest";
import { CORE_9_LENSES, buildCriticSchema } from "../src/critic.js";
import { ProfileSchema } from "../src/profile.js";

const profile = ProfileSchema.parse({
  schema_version: "1.0",
  profile_id: "generic",
  extra_lenses: ["custom_a", "custom_b", "custom_c", "custom_d"],
});

const criticSchema = buildCriticSchema(profile);

const basePerLens = { lens_id: CORE_9_LENSES[0] };

describe("buildCriticSchema", () => {
  it("allows core 9 lenses plus at most the profile's first 3 extra_lenses", () => {
    const result = criticSchema.safeParse({
      schema_version: "1.0",
      intent_id: "I-2026-07-31-x",
      decision: "pass",
      confidence: "high",
      per_lens: [
        { ...basePerLens, result: "not_applicable" },
        { lens_id: "custom_a", result: "not_applicable" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a lens_id beyond the first 3 extra_lenses", () => {
    const result = criticSchema.safeParse({
      schema_version: "1.0",
      intent_id: "I-2026-07-31-x",
      decision: "pass",
      confidence: "high",
      per_lens: [{ lens_id: "custom_d", result: "not_applicable" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate lens_id", () => {
    const result = criticSchema.safeParse({
      schema_version: "1.0",
      intent_id: "I-2026-07-31-x",
      decision: "pass",
      confidence: "high",
      per_lens: [
        { ...basePerLens, result: "not_applicable" },
        { ...basePerLens, result: "not_applicable" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("requires finding+taxonomy when result=applicable", () => {
    const result = criticSchema.safeParse({
      schema_version: "1.0",
      intent_id: "I-2026-07-31-x",
      decision: "pass",
      confidence: "high",
      per_lens: [{ ...basePerLens, result: "applicable" }],
    });
    expect(result.success).toBe(false);
  });

  it("requires a triggered halt_trigger when decision=blocked", () => {
    const result = criticSchema.safeParse({
      schema_version: "1.0",
      intent_id: "I-2026-07-31-x",
      decision: "blocked",
      confidence: "high",
      per_lens: [{ ...basePerLens, result: "not_applicable" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts decision=blocked with a triggered halt_trigger", () => {
    const result = criticSchema.safeParse({
      schema_version: "1.0",
      intent_id: "I-2026-07-31-x",
      decision: "blocked",
      confidence: "high",
      per_lens: [{ ...basePerLens, result: "not_applicable" }],
      halt_triggers: [{ condition: "forbidden path touched", triggered: true }],
    });
    expect(result.success).toBe(true);
  });
});
