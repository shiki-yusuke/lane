import { describe, expect, it } from "vitest";
import { LaneStateSchemaV2, parseLaneState } from "../src/lane-state.js";

const v1Fixture = {
  intent_id: "I-2026-07-31-example-feature",
  current_phase: "2_spec",
  status: "running",
  created_at: "2026-07-31T09:00:00+09:00",
  phase_history: [
    {
      phase: "1_intent",
      started_at: "2026-07-31T09:00:00+09:00",
      ended_at: "2026-07-31T09:05:00+09:00",
      result: "completed",
      retry_count: 0,
    },
  ],
};

describe("parseLaneState version dispatch", () => {
  it("parses a v2 file directly", () => {
    const v2 = LaneStateSchemaV2.parse({
      schema_version: "2.0",
      intent_id: "I-2026-07-31-example-feature",
      tracker_url: null,
      pr_url: null,
      owner: null,
      current_phase: "1_intent",
      status: "pending",
      created_at: "2026-07-31T09:00:00+09:00",
    });
    const result = parseLaneState(v2);
    expect(result.schema_version).toBe("2.0");
  });

  it("migrates a pre-rev2 (v1, no schema_version) file to v2 shape", () => {
    const migrated = parseLaneState(v1Fixture);
    expect(migrated.schema_version).toBe("2.0");
    expect(migrated.pr_provenance).toBeNull();
    expect(migrated.effective_risk_log).toEqual([]);
    expect(migrated.mode_resolution_log).toEqual([]);
    expect(migrated.phase_history).toHaveLength(1);
  });

  it("is idempotent: migrating twice yields the same result as migrating once", () => {
    const once = parseLaneState(v1Fixture);
    const twice = parseLaneState(once);
    expect(twice).toEqual(once);
  });
});
