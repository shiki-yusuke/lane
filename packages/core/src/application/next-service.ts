import type { BudgetConstraint } from "@lane/schemas";
import type { ResourceSnapshot } from "../ports/budget.js";

// design.md §4.2/§5.2 — `lane next` never invents a fits/not_fit verdict across units it
// cannot honestly compare. A "fits" judgement here means "predicted p80 cost and a
// budget constraint are denominated in the exact same unit and the constraint's provider
// matches" — no percent-used-to-dollars conversion is attempted anywhere in this module.

export type NextVerdict = "fits" | "not_fit" | "advisory" | "unknown";

export interface NextCandidateInput {
  intentId: string;
  /** null when there is no adopted baseline estimate yet (e.g. population < 8, reference_table). */
  predictedCostP80: {
    value: number;
    unit: "usd" | "credits";
    provider: "claude" | "codex" | "any";
  } | null;
  budget: readonly BudgetConstraint[];
}

export interface NextRow {
  intentId: string;
  verdict: NextVerdict;
  detail: string;
}

// M3 (design.md §5.2): "stale" (a measured source aged past its TTL), "unpriced", and
// "lower_bound" (agent-cost couldn't fully price the underlying usage — §4.2) all suppress
// the recommendation the same way. "computed_low_confidence" alone does not — that's
// CodexBudgetAdapter's unavoidable baseline, still shown as an advisory number, not a reason
// to hide everything.
const DEGRADED_QUALITIES = new Set<ResourceSnapshot["quality"]>([
  "stale",
  "unpriced",
  "lower_bound",
]);

/**
 * The distinct degraded qualities present across `snapshots`, sorted for a deterministic
 * message (Codex M3 review, should-7: the old suppression message always said "stale"
 * regardless of whether the real cause was staleness, unpriced usage, or a lower-bound
 * estimate — this is what lets the caller report the *actual* reason).
 */
export function degradedQualities(
  snapshots: readonly ResourceSnapshot[],
): ResourceSnapshot["quality"][] {
  const found = new Set<ResourceSnapshot["quality"]>();
  for (const s of snapshots) {
    if (DEGRADED_QUALITIES.has(s.quality)) found.add(s.quality);
  }
  return [...found].sort();
}

/** True if any snapshot's quality/coverage is degraded enough that a recommendation should not be shown. */
export function hasDegradedSnapshot(snapshots: readonly ResourceSnapshot[]): boolean {
  return degradedQualities(snapshots).length > 0;
}

export function buildNextRow(
  input: NextCandidateInput,
  opts: { suppressVerdict: boolean; degradedQualities?: readonly ResourceSnapshot["quality"][] },
): NextRow {
  if (opts.suppressVerdict) {
    const reason = opts.degradedQualities?.length ? opts.degradedQualities.join(", ") : "degraded";
    return {
      intentId: input.intentId,
      verdict: "advisory",
      detail: `recommendation suppressed: resource snapshot quality is ${reason}`,
    };
  }
  if (!input.predictedCostP80) {
    return { intentId: input.intentId, verdict: "unknown", detail: "no adopted baseline estimate" };
  }
  const matching = input.budget.find(
    (b) =>
      b.unit === input.predictedCostP80?.unit &&
      (b.provider === input.predictedCostP80.provider ||
        b.provider === "any" ||
        input.predictedCostP80.provider === "any"),
  );
  if (!matching) {
    return {
      intentId: input.intentId,
      verdict: "advisory",
      detail: `no budget constraint in the same unit (${input.predictedCostP80.unit}); no verified conversion is applied`,
    };
  }
  return {
    intentId: input.intentId,
    verdict: input.predictedCostP80.value <= matching.limit ? "fits" : "not_fit",
    detail: `${input.predictedCostP80.value} ${matching.unit} vs budget ${matching.limit} ${matching.unit} (provider=${matching.provider})`,
  };
}

/** Pure formatting; never decides fits/not_fit — snapshots are always shown as-is, side by side. */
export function formatResourceSnapshot(s: ResourceSnapshot): string {
  const qualityNote = s.quality === "measured" ? "" : ` [${s.quality}]`;
  return `${s.provider} ${s.metric}=${s.value}${s.unit === "percent_used" ? "%" : ` ${s.unit}`}${qualityNote}`;
}
