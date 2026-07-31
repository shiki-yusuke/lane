import type { AgentCostMeasureResult } from "@lane/schemas";

// design.md §4.1 — agent-cost stays a Python CLI; lane calls it as a subprocess rather
// than reimplementing it (sol: avoids double maintenance). M1 shipped a speculative
// window-keyed interface here (agent-cost's own `measure --format json` contract did not
// exist yet); agent-cost's real contract (published 2026-07-31, see
// AgentCostMeasureResultSchema in @lane/schemas) is session-id keyed instead — at least
// one --session-id is required per call, and the response is pre-aggregated per-session
// and union totals, not a flat facts[] array. Lane is responsible for knowing which
// session ids belong to a phase occurrence — recorded directly on
// LedgerEntry.session_ids (§2.5/§3.6) by whatever captured them (a `lane usage-import`
// command reading caller-supplied ids), not log-scanning inside this port.
export interface TelemetryMeasureOptions {
  since?: Date;
  until?: Date;
  agents?: readonly ("claude" | "codex")[];
}

export interface TelemetryAdapter {
  /** Throws if sessionIds is empty — agent-cost's own measure requires at least one. */
  measure(
    sessionIds: readonly string[],
    opts?: TelemetryMeasureOptions,
  ): Promise<AgentCostMeasureResult>;
}
