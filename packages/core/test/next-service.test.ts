import { describe, expect, it } from "vitest";
import {
  buildNextRow,
  degradedQualities,
  hasDegradedSnapshot,
} from "../src/application/next-service.js";
import type { ResourceSnapshot } from "../src/ports/budget.js";

describe("buildNextRow", () => {
  it("fits when predicted cost and a budget constraint share the same unit and provider", () => {
    const row = buildNextRow(
      {
        intentId: "I-1",
        predictedCostP80: { value: 7.8, unit: "usd", provider: "claude" },
        budget: [{ provider: "claude", unit: "usd", limit: 10 }],
      },
      { suppressVerdict: false },
    );
    expect(row.verdict).toBe("fits");
  });

  it("not_fit when the same-unit budget constraint is exceeded", () => {
    const row = buildNextRow(
      {
        intentId: "I-1",
        predictedCostP80: { value: 15, unit: "usd", provider: "claude" },
        budget: [{ provider: "claude", unit: "usd", limit: 10 }],
      },
      { suppressVerdict: false },
    );
    expect(row.verdict).toBe("not_fit");
  });

  it("advisory when no budget constraint shares the predicted cost's unit (no invented conversion)", () => {
    const row = buildNextRow(
      {
        intentId: "I-1",
        predictedCostP80: { value: 21, unit: "usd", provider: "codex" },
        budget: [{ provider: "codex", unit: "credits", limit: 500 }],
      },
      { suppressVerdict: false },
    );
    expect(row.verdict).toBe("advisory");
  });

  it("unknown when there is no adopted baseline estimate", () => {
    const row = buildNextRow(
      { intentId: "I-1", predictedCostP80: null, budget: [] },
      { suppressVerdict: false },
    );
    expect(row.verdict).toBe("unknown");
  });

  it("suppresses the verdict entirely when a snapshot is stale", () => {
    const row = buildNextRow(
      {
        intentId: "I-1",
        predictedCostP80: { value: 1, unit: "usd", provider: "claude" },
        budget: [{ provider: "claude", unit: "usd", limit: 10 }],
      },
      { suppressVerdict: true },
    );
    expect(row.verdict).toBe("advisory");
  });

  it("should-7: the suppression message names the actual degraded quality, not always 'stale'", () => {
    const row = buildNextRow(
      {
        intentId: "I-1",
        predictedCostP80: { value: 1, unit: "usd", provider: "claude" },
        budget: [{ provider: "claude", unit: "usd", limit: 10 }],
      },
      { suppressVerdict: true, degradedQualities: ["unpriced"] },
    );
    expect(row.detail).toContain("unpriced");
    expect(row.detail).not.toContain("stale");
  });

  it("should-7: names every distinct degraded quality when more than one is present", () => {
    const row = buildNextRow(
      {
        intentId: "I-1",
        predictedCostP80: { value: 1, unit: "usd", provider: "claude" },
        budget: [{ provider: "claude", unit: "usd", limit: 10 }],
      },
      { suppressVerdict: true, degradedQualities: ["lower_bound", "stale"] },
    );
    expect(row.detail).toContain("lower_bound");
    expect(row.detail).toContain("stale");
  });
});

describe("degradedQualities", () => {
  it("returns the distinct degraded qualities present, sorted, excluding non-degraded ones", () => {
    const snapshots: ResourceSnapshot[] = [
      {
        provider: "claude",
        metric: "rate_limit_5h",
        value: 42,
        unit: "percent_used",
        observedAt: new Date(),
        expiresAt: null,
        quality: "stale",
        source: "x",
      },
      {
        provider: "codex",
        metric: "credit_balance",
        value: 100,
        unit: "credits",
        observedAt: new Date(),
        expiresAt: null,
        quality: "unpriced",
        source: "y",
      },
      {
        provider: "codex",
        metric: "credit_balance",
        value: 200,
        unit: "credits",
        observedAt: new Date(),
        expiresAt: null,
        quality: "computed_low_confidence",
        source: "z",
      },
    ];
    expect(degradedQualities(snapshots)).toEqual(["stale", "unpriced"]);
  });

  it("returns [] when nothing is degraded", () => {
    const snapshots: ResourceSnapshot[] = [
      {
        provider: "claude",
        metric: "rate_limit_5h",
        value: 10,
        unit: "percent_used",
        observedAt: new Date(),
        expiresAt: null,
        quality: "measured",
        source: "x",
      },
    ];
    expect(degradedQualities(snapshots)).toEqual([]);
  });
});

describe("hasDegradedSnapshot", () => {
  it("is true when any snapshot is stale", () => {
    const snapshots: ResourceSnapshot[] = [
      {
        provider: "claude",
        metric: "rate_limit_5h",
        value: 42,
        unit: "percent_used",
        observedAt: new Date(),
        expiresAt: null,
        quality: "stale",
        source: "x",
      },
    ];
    expect(hasDegradedSnapshot(snapshots)).toBe(true);
  });

  it("is false when all snapshots are measured or computed_low_confidence", () => {
    const snapshots: ResourceSnapshot[] = [
      {
        provider: "claude",
        metric: "rate_limit_5h",
        value: 42,
        unit: "percent_used",
        observedAt: new Date(),
        expiresAt: null,
        quality: "measured",
        source: "x",
      },
      {
        provider: "codex",
        metric: "credit_balance",
        value: 6200,
        unit: "credits",
        observedAt: new Date(),
        expiresAt: null,
        quality: "computed_low_confidence",
        source: "y",
      },
    ];
    expect(hasDegradedSnapshot(snapshots)).toBe(false);
  });

  it.each(["unpriced", "lower_bound"] as const)(
    "is true when any snapshot has quality=%s (M3: agent-cost couldn't fully price the underlying usage)",
    (quality) => {
      const snapshots: ResourceSnapshot[] = [
        {
          provider: "codex",
          metric: "credit_balance",
          value: 6200,
          unit: "credits",
          observedAt: new Date(),
          expiresAt: null,
          quality,
          source: "x",
        },
      ];
      expect(hasDegradedSnapshot(snapshots)).toBe(true);
    },
  );
});
