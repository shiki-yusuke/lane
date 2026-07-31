// design.md §4.2 — Claude's rate-limit percentage and Codex's credit balance are different
// units and different confidence levels; ResourceSnapshot keeps them explicit rather than
// collapsing into one "budget used" number (sol: avoids a false sense of certainty). M1
// ships this interface only; ClaudeBudgetAdapter/CodexBudgetAdapter are M2.
export interface ResourceSnapshot {
  provider: "claude" | "codex";
  metric: "rate_limit_5h" | "rate_limit_7d" | "credit_balance";
  value: number;
  unit: "percent_used" | "credits" | "usd";
  observedAt: Date;
  /** TTL, relative to when the snapshot was written — null means no expiry is known. */
  expiresAt: Date | null;
  /**
   * "measured": read directly from a live source (ClaudeBudgetAdapter's rate-limits.json
   * within its TTL). "computed_low_confidence": CodexBudgetAdapter's baseline — a
   * manually-entered limit minus an agent-cost-derived estimate, always at least this
   * uncertain even in the best case. "stale": a `measured` source aged past its TTL.
   * "unpriced"/"lower_bound" (M3, design.md §4.2): the agent-cost pricing catalog could not
   * fully price the underlying usage this snapshot is derived from (agent_cost/aggregate.py's
   * own pricing_status ranking) — a *different* reason to distrust the number than staleness,
   * kept distinct rather than collapsed into "stale" so the cause stays legible. All three of
   * stale/unpriced/lower_bound suppress `lane next`'s recommendation the same way (§5.2).
   */
  quality: "measured" | "computed_low_confidence" | "stale" | "unpriced" | "lower_bound";
  source: string;
}

export interface BudgetAdapter {
  snapshot(): Promise<ResourceSnapshot[]>;
}
