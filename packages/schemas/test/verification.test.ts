import { describe, expect, it } from "vitest";
import { DeviationSchema, SpecConsensusSchema, VerificationSchema } from "../src/verification.js";

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

// Gate-port review (2026-08-06) — success_criteria_matrix/cross_check_intent_vs_spec are
// new optional fields; core/gate.ts's successCriteriaGate is what turns covered_by:"none"
// into a hard error, not this schema (see verification.ts's field-level comment for why).
describe("VerificationSchema: success_criteria_matrix / cross_check_intent_vs_spec", () => {
  const withMatrix = (matrix: unknown) => ({
    schema_version: "1.0",
    intent_id: "I-2026-07-31-example-feature",
    test_matrix: [{ ears_rule: "Rule 1", test_type: "unit", status: "added" }],
    success_criteria_matrix: matrix,
  });

  it("is entirely optional — a Verification with no success_criteria_matrix key at all is still valid", () => {
    const result = VerificationSchema.safeParse({
      schema_version: "1.0",
      intent_id: "I-2026-07-31-example-feature",
      test_matrix: [{ ears_rule: "Rule 1", test_type: "unit", status: "added" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts covered_by:'none' at the schema level (the gate is what fails it, not the schema)", () => {
    const result = VerificationSchema.safeParse(
      withMatrix([{ criterion: "x", covered_by: "none", evidence: "n/a" }]),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a row with negation_test omitted (optional; the gate warns, the schema does not reject)", () => {
    const result = VerificationSchema.safeParse(
      withMatrix([{ criterion: "x", covered_by: "test", evidence: "test.ts::x" }]),
    );
    expect(result.success).toBe(true);
  });

  it("rejects an empty success_criteria_matrix array (min(1) when the key is present at all)", () => {
    const result = VerificationSchema.safeParse(withMatrix([]));
    expect(result.success).toBe(false);
  });

  it("accepts cross_check_intent_vs_spec as a free-form date-plus-phase label, not a strict ISO timestamp", () => {
    const result = VerificationSchema.safeParse({
      schema_version: "1.0",
      intent_id: "I-2026-07-31-example-feature",
      test_matrix: [{ ears_rule: "Rule 1", test_type: "unit", status: "added" }],
      cross_check_intent_vs_spec: {
        performed_at: "2026-08-06 (Phase 4)",
        finding: "No stronger condition found in spec.md than intent.success already states.",
      },
    });
    expect(result.success).toBe(true);
  });
});
