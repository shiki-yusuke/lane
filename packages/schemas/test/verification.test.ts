import { describe, expect, it } from "vitest";
import { DeviationSchema, SpecConsensusSchema } from "../src/verification.js";

describe("DeviationSchema refine invariants", () => {
  it("rejects status=resolved without rationale, even for action=accept", () => {
    const result = DeviationSchema.safeParse({
      spec_ref: "spec.md#rule-1",
      actual: "differs slightly",
      action: "accept",
      status: "resolved",
    });
    expect(result.success).toBe(false);
  });

  it("accepts status=pending without rationale", () => {
    const result = DeviationSchema.safeParse({
      spec_ref: "spec.md#rule-1",
      actual: "differs slightly",
      action: "fix",
      status: "pending",
    });
    expect(result.success).toBe(true);
  });
});

describe("SpecConsensusSchema refine invariants", () => {
  const base = {
    spec_ssot_ref: "docs/spec/I-2026-07-31-x/spec.md",
    spec_digest: "aaaa",
    verification_digest: "bbbb",
    deviations: [],
  };

  it("rejects a reviewer_ack whose digest no longer matches spec/verification digest", () => {
    const result = SpecConsensusSchema.safeParse({
      ...base,
      reviewer_ack: {
        reviewer_kind: "self",
        reviewer_id: "reviewer-1",
        acked_at: "2026-07-31T09:00:00+09:00",
        spec_sha256: "stale-digest",
        verification_sha256: "bbbb",
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a reviewer_ack whose digest matches", () => {
    const result = SpecConsensusSchema.safeParse({
      ...base,
      reviewer_ack: {
        reviewer_kind: "self",
        reviewer_id: "reviewer-1",
        acked_at: "2026-07-31T09:00:00+09:00",
        spec_sha256: "aaaa",
        verification_sha256: "bbbb",
      },
    });
    expect(result.success).toBe(true);
  });
});
