import { type Intent, IntentSchema, type RiskUpgradeRule } from "@lane/schemas";
import { describe, expect, it } from "vitest";
import { evaluateEffectiveRisk, maxRisk, ruleMatches } from "../src/risk.js";

function buildIntent(overrides: Partial<Intent["ai_inferred_scope"]> = {}): Intent {
  return IntentSchema.parse({
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
      ...overrides,
    },
  });
}

describe("maxRisk", () => {
  it("returns the highest risk level among the inputs", () => {
    expect(maxRisk(["low", "medium", "low"])).toBe("medium");
    expect(maxRisk(["low", "high", "medium"])).toBe("high");
    expect(maxRisk(["low"])).toBe("low");
  });
});

describe("ruleMatches", () => {
  it("matches on affected_layers overlap", () => {
    const rule: RiskUpgradeRule = {
      id: "r1",
      when: { layers: ["ci"] },
      upgrade_to: "high",
      reason: "x",
    };
    expect(ruleMatches(rule, buildIntent({ affected_layers: ["ci", "docs"] }))).toBe(true);
    expect(ruleMatches(rule, buildIntent({ affected_layers: ["docs"] }))).toBe(false);
  });

  it("matches on allowed_paths glob overlap", () => {
    const rule: RiskUpgradeRule = {
      id: "r2",
      when: { paths: [".github/workflows/**"] },
      upgrade_to: "high",
      reason: "x",
    };
    expect(ruleMatches(rule, buildIntent({ allowed_paths: [".github/workflows/ci.yml"] }))).toBe(
      true,
    );
    expect(ruleMatches(rule, buildIntent({ allowed_paths: ["docs/**"] }))).toBe(false);
  });

  it("never matches an empty when clause", () => {
    const rule: RiskUpgradeRule = { id: "r3", when: {}, upgrade_to: "high", reason: "x" };
    expect(ruleMatches(rule, buildIntent())).toBe(false);
  });
});

describe("evaluateEffectiveRisk", () => {
  const rules: RiskUpgradeRule[] = [
    { id: "ci-touch", when: { paths: [".github/workflows/**"] }, upgrade_to: "high", reason: "x" },
  ];

  it("upgrades effective risk above declared when a rule matches", () => {
    const intent = buildIntent({ allowed_paths: [".github/workflows/ci.yml"] });
    const result = evaluateEffectiveRisk("low", null, intent, rules);
    expect(result.effective).toBe("high");
    expect(result.appliedRuleIds).toEqual(["ci-touch"]);
  });

  it("never downgrades below the previous effective risk", () => {
    const intent = buildIntent(); // no rule matches this time
    const result = evaluateEffectiveRisk("low", "high", intent, rules);
    expect(result.effective).toBe("high");
    expect(result.appliedRuleIds).toEqual([]);
  });

  it("stays at declared risk when nothing upgrades it", () => {
    const intent = buildIntent();
    const result = evaluateEffectiveRisk("medium", null, intent, rules);
    expect(result.effective).toBe("medium");
  });
});
