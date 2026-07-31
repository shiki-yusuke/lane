import {
  type Intent,
  IntentSchema,
  type LaneState,
  LaneStateSchemaV2,
  type Profile,
  ProfileSchema,
  type Verification,
  VerificationSchema,
} from "@lane/schemas";
import { describe, expect, it } from "vitest";
import { type GateContext, specConsensusGate } from "../src/gate.js";
import { recordEffectiveRiskEvaluation } from "../src/risk.js";

const intent: Intent = IntentSchema.parse({
  schema_version: "1.0",
  intent_id: "I-2026-07-31-example-feature",
  intent: {
    business_goal: "Reduce onboarding time by clarifying setup docs.",
    user_visible_intent: "New users see setup steps in order.",
    success: ["ok"],
    primary_user: "new_developer",
    declared_risk: "low",
  },
  ai_inferred_scope: {
    affected_layers: ["docs"],
    confidence: "medium",
    allowed_paths: ["docs/**"],
  },
});

const profile: Profile = ProfileSchema.parse({ schema_version: "1.0", profile_id: "generic" });

function buildState(overrides: Partial<LaneState> = {}): LaneState {
  return LaneStateSchemaV2.parse({
    schema_version: "2.0",
    intent_id: intent.intent_id,
    tracker_url: null,
    pr_url: null,
    owner: null,
    current_phase: "4_verify",
    status: "running",
    created_at: "2026-07-31T09:00:00+09:00",
    ...overrides,
  });
}

function buildVerification(specConsensus: Record<string, unknown> | undefined): Verification {
  return VerificationSchema.parse({
    schema_version: "1.0",
    intent_id: intent.intent_id,
    test_matrix: [{ ears_rule: "Rule 1", test_type: "unit", status: "added" }],
    spec_consensus: specConsensus,
  });
}

function buildContext(overrides: Partial<GateContext["artifacts"]>): GateContext {
  return {
    phase: "4_verify",
    targetPhase: "5_done",
    event: "before_pr_publish",
    state: buildState(),
    profile,
    artifacts: { intent, ...overrides },
  };
}

describe("specConsensusGate", () => {
  it("fails when spec_consensus is missing entirely", () => {
    const result = specConsensusGate.evaluate(buildContext({}));
    expect(result.pass).toBe(false);
  });

  it("fails when there is a pending deviation", () => {
    const result = specConsensusGate.evaluate(
      buildContext({
        verification: buildVerification({
          spec_ssot_ref: "docs/spec/x/spec.md",
          spec_digest: "aaaa",
          verification_digest: "bbbb",
          deviations: [{ spec_ref: "spec.md#1", actual: "x", action: "fix", status: "pending" }],
          reviewer_ack: null,
        }),
      }),
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.reason).toMatch(/unresolved deviation/);
  });

  it("fails when the current spec/verification digest no longer matches the ack", () => {
    const result = specConsensusGate.evaluate(
      buildContext({
        verification: buildVerification({
          spec_ssot_ref: "docs/spec/x/spec.md",
          spec_digest: "aaaa",
          verification_digest: "bbbb",
          deviations: [],
          reviewer_ack: {
            reviewer_kind: "self",
            reviewer_id: "reviewer-1",
            acked_at: "2026-07-31T09:00:00+09:00",
            spec_sha256: "aaaa",
            verification_sha256: "bbbb",
          },
        }),
        specDigest: { spec: "changed-digest", verification: "bbbb" },
      }),
    );
    expect(result.pass).toBe(false);
    if (!result.pass) expect(result.reason).toMatch(/digest mismatch/);
  });

  it("passes with no pending deviations and a valid ack", () => {
    const result = specConsensusGate.evaluate(
      buildContext({
        verification: buildVerification({
          spec_ssot_ref: "docs/spec/x/spec.md",
          spec_digest: "aaaa",
          verification_digest: "bbbb",
          deviations: [
            {
              spec_ref: "spec.md#1",
              actual: "x",
              action: "accept",
              status: "resolved",
              rationale: "acceptable",
            },
          ],
          reviewer_ack: {
            reviewer_kind: "self",
            reviewer_id: "reviewer-1",
            acked_at: "2026-07-31T09:00:00+09:00",
            spec_sha256: "aaaa",
            verification_sha256: "bbbb",
          },
        }),
      }),
    );
    expect(result.pass).toBe(true);
  });

  it("requires override_reason for a self ack when effective risk is high", () => {
    const state = buildState({
      effective_risk_log: [
        {
          gate_id: "spec_consensus",
          effective_risk: "high",
          applied_rule_ids: [],
          profile_digest: "d",
          evaluated_at: "2026-07-31T09:00:00+09:00",
        },
      ],
    });
    const ctx: GateContext = {
      phase: "4_verify",
      targetPhase: "5_done",
      event: "before_pr_publish",
      state,
      profile,
      artifacts: {
        intent,
        verification: buildVerification({
          spec_ssot_ref: "docs/spec/x/spec.md",
          spec_digest: "aaaa",
          verification_digest: "bbbb",
          deviations: [],
          reviewer_ack: {
            reviewer_kind: "self",
            reviewer_id: "reviewer-1",
            acked_at: "2026-07-31T09:00:00+09:00",
            spec_sha256: "aaaa",
            verification_sha256: "bbbb",
          },
        }),
      },
    };
    const result = specConsensusGate.evaluate(ctx);
    expect(result.pass).toBe(false);
  });

  it("a profile's risk_auto_upgrade rule actually changes the gate outcome, end to end (Codex M1 review, must-3)", () => {
    // Regression: evaluateEffectiveRisk/evaluateEffectiveRiskForProfile existed but were
    // never wired into the gate-evaluation path, so a profile's risk_auto_upgrade rules
    // had no effect on any real gate decision ("dead config" — the same failure mode
    // the Python reference implementation's own risk_auto_upgrade had, which design.md §3.4 was written to avoid
    // repeating). This test proves the wiring (recordEffectiveRiskEvaluation) actually
    // changes specConsensusGate's outcome for the *same* verification/ack content, purely
    // because of the profile's rules and the intent's allowed_paths.
    const highRiskIntent: Intent = IntentSchema.parse({
      ...intent,
      ai_inferred_scope: {
        ...intent.ai_inferred_scope,
        allowed_paths: [".github/workflows/ci.yml"],
      },
    });
    const profileWithRule: Profile = ProfileSchema.parse({
      schema_version: "1.0",
      profile_id: "generic",
      risk_auto_upgrade: [
        {
          id: "ci-workflow-touch",
          when: { paths: [".github/workflows/**"] },
          upgrade_to: "high",
          reason: "CI workflow changes can affect every future PR.",
        },
      ],
    });
    const selfAckVerification = buildVerification({
      spec_ssot_ref: "docs/spec/x/spec.md",
      spec_digest: "aaaa",
      verification_digest: "bbbb",
      deviations: [],
      reviewer_ack: {
        reviewer_kind: "self",
        reviewer_id: "reviewer-1",
        acked_at: "2026-07-31T09:00:00+09:00",
        spec_sha256: "aaaa",
        verification_sha256: "bbbb",
      },
    });

    // Without the rule (a profile with no risk_auto_upgrade entries): declared=low stays
    // low, so a self ack with no override_reason is allowed.
    const stateWithoutRule = recordEffectiveRiskEvaluation(
      buildState(),
      highRiskIntent,
      profile, // profile fixture at module scope has risk_auto_upgrade: []
      "spec_consensus",
      "2026-07-31T09:00:00+09:00",
    );
    const withoutRule = specConsensusGate.evaluate({
      phase: "4_verify",
      targetPhase: "5_done",
      event: "before_pr_publish",
      state: stateWithoutRule,
      profile,
      artifacts: { intent: highRiskIntent, verification: selfAckVerification },
    });
    expect(withoutRule.pass).toBe(true);

    // With the rule, on the exact same intent/verification/ack: effective risk is
    // recomputed to high, and the gate now requires override_reason for the self ack.
    const stateWithRule = recordEffectiveRiskEvaluation(
      buildState(),
      highRiskIntent,
      profileWithRule,
      "spec_consensus",
      "2026-07-31T09:00:00+09:00",
    );
    expect(stateWithRule.effective_risk_log.at(-1)?.effective_risk).toBe("high");
    expect(stateWithRule.effective_risk_log.at(-1)?.applied_rule_ids).toEqual([
      "ci-workflow-touch",
    ]);
    const withRule = specConsensusGate.evaluate({
      phase: "4_verify",
      targetPhase: "5_done",
      event: "before_pr_publish",
      state: stateWithRule,
      profile: profileWithRule,
      artifacts: { intent: highRiskIntent, verification: selfAckVerification },
    });
    expect(withRule.pass).toBe(false);
  });
});
