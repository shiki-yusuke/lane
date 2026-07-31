---
name: lane
description: Delivery lane orchestrator's default entry point. Drives Phase 1 (Intent) through Phase 4 (Verify/PR) using `lane status <intent-id>` to determine the current phase, then advances a single phase or forward to the next gate (never advances past PR creation on its own). Use for starting/resuming a lane, checking status, moving to the next phase, or opening a PR, or for a plain request like "move this lane forward" / "write the spec" / "implement this" / "verify and open a PR" that doesn't name a specific phase. For Phase 5 (post-merge closeout) use lane-finish instead.
---

# Lane Orchestrator (drives Phase 1 -> 4)

This skill is the command center that moves a lane from wherever it currently is toward
the next gate. It does not replace judgment about spec content, code quality, or risk —
it only governs *which* phase runs next and *where it must stop*.

> **Router invariant**: this is the default entry point for Phase 1-4. Even when the user
> names a single phase ("write the spec", "implement", "verify"), always start by running
> `lane status <intent-id>` to confirm the current phase, then run whatever this skill says
> for *that* phase. Never invent phase logic outside what's described here. Phase 5 (done),
> anything post-merge, and multi-lane batch closeout belong to `lane-finish` — never run
> `advance --phase 5_done` from this skill.

## When to use this

- "move this lane forward", "take this to PR", "advance to the next phase", "resume this lane"
- "Phase 3, go" (a single named phase is fine too — still confirm via `status` first)
- Starting a brand-new lane ("start a lane for X")

> **Phase 5 is out of scope here.** This skill's forward-drive always stops once a PR is
> open (Phase 4). Post-merge closeout is [lane-finish](../lane-finish/SKILL.md).

## Basic flow (always in this order)

1. **Confirm the current phase.** Run `lane status <intent-id>`. Trust `current_phase` over
   any assumption about where the lane "should" be.
   - If the lane doesn't exist yet (`lane status` fails), this is a **new lane**: go to
     "Phase (none) -> 1_intent" below.
2. **Decide how far to go.** A single named phase runs and stops. "Move it forward" /
   "take it to PR" / no scope given means run phase-by-phase until a gate stops you or
   Phase 4 is reached.
3. **Run the phase** (see the table below).
4. **Stop at any gate** (see "Stopping rules") and report to the user what's blocking and
   what decision they need to make.

## Phase-by-phase

| current_phase | do this | then |
|---|---|---|
| (none) | `lane start <intent-id> --business-goal "..." --user-visible-intent "..." --primary-user "..." --risk low\|medium\|high --affected-layer <layer> [--affected-layer ...] --allowed-path <glob> [--allowed-path ...]`. Fill in real content — the flags exist so intent.yaml doesn't ship with placeholder text. Then `lane validate <intent-id>`. | now at 1_intent |
| 1_intent | Write `docs/spec/<intent-id>/spec.md` (EARS requirements + Gherkin scenarios) and `docs/spec/<intent-id>/critic.yaml` (the 9-lens self-review: lifecycle_management / error_handling / security / performance / a11y / i18n / architecture / test_coverage / documentation). Each lens has its own `result: applicable\|not_applicable\|unknown` (`applicable` requires `finding`+`taxonomy`; `unknown` requires `open_question`); the overall `decision: pass\|needs_revision\|blocked` is a single top-level field, not per-lens. Before writing critic.yaml, run `lane knowledge-query --paths <files this change will touch>` and fold matches into each lens's `knowledge_candidates` (design.md §5.4) — this is the knowledge-DB injection feature, not optional decoration. Also run `lane estimate <intent-id> [--impact-scan-file <report.md>] --adopt` if a cost/effort estimate is useful before committing to the work; without `--impact-scan-file` the estimate falls back to a generic reference table (still recorded, just marked `experimental`/low-confidence). Then `lane validate <intent-id>` (schema-checks intent.yaml always, and critic.yaml if it exists yet), then `lane advance <intent-id> --phase 2_spec`. | now at 2_spec |
| 2_spec | Create a branch, write the real code + tests. Run this project's own lint/typecheck/test before moving on — this skill doesn't define those commands; use whatever the target repo's own tooling is. | run `lane advance <intent-id> --phase 3_implement` when it's green |
| 3_implement | Write `docs/spec/<intent-id>/verification.yaml` (test_matrix mapping EARS rules to tests, test_gaps, manual_verification, goal_stopping_condition). Then initialize spec_consensus: `lane consensus <intent-id> --refresh --spec-ssot-ref <path to the spec this change traces to>`. If the implementation deviates from the spec at all (including "no deviation, confirmed"), record it: `lane consensus <intent-id> --add-deviation --spec-ref <ref> --actual "<what actually happened>" --action accept\|fix\|update_spec`, then `--resolve-deviation <spec-ref> --rationale "..."`. Once every deviation is resolved, ack it: `lane consensus <intent-id> --ack --reviewer-kind self\|independent_agent\|human --reviewer-id <id>` (a `self` ack at effective risk=high needs `--override-reason`). Then `lane advance <intent-id> --phase 4_verify`. Commit, push, and open a PR (`git`/`gh` directly — no CLI wrapper for this in v1). Optionally run `lane consensus <intent-id> --emit-pr-section` and paste its output into the PR description. | PR open, **stop** |
| 4_verify | **Stop here.** The PR is open; merging is the user's call. Before stopping, run `lane validate <intent-id>` — this dry-runs the same spec_consensus gate `advance --phase 5_done` will enforce later, so a missing ack surfaces now instead of after merge. | — |

## Stopping rules (gates — never proceed past these without the user)

- **1_intent -> 2_spec**: `declared_risk` medium or higher -> stop for intent approval before
  writing spec.md.
- **2_spec -> 3_implement**: critic.yaml `decision: needs_revision` (2+ must-level findings)
  or `blocked` (a forbidden_paths violation or a serious security finding) -> stop.
  Reviewing the spec content itself with the user before implementing is also recommended
  for anything non-trivial.
- **3_implement**: `declared_risk: high` needs approval before implementation starts.
  Hard-halt immediately on: an existing e2e/regression test going from green to red, a
  change outside `allowed_paths`, anything touching migrations/IaC/lockfiles, or anything
  touching auth/billing/personal data.
- **4_verify -> merge**: always stop once the PR is open and reviewed. Merging is the
  user's decision, never automatic. If review comes back with 2+ must-level findings,
  `lane advance <intent-id> --phase 2_spec` to re-enter spec (confirm this with the user
  first, don't loop back automatically).
- **Runaway retries**: stop after 3 consecutive lint/typecheck-fix failures, or if the same
  error recurs after a fix attempt. Don't keep retrying blindly — report what's failing.

## Forward-drive invariants

- The ceiling is **PR creation (Phase 4)**. Never advance to Phase 5 from this skill —
  that's `lane-finish`, and it only runs after the user confirms the PR merged.
- Re-run `lane status` after each phase transition rather than assuming `advance` succeeded
  silently.
- Always tell the user how far you got and what decision (if any) they need to make next.

## Evolved features woven into the flow above

- **Estimate/calibrate** (design.md §5.1): `lane estimate` at Phase 1 gives a cost/effort
  prediction with an honest confidence signal (`population_condition.method` /
  `experimental`); `--adopt` records it as the baseline this lane will later be measured
  against. Measurement happens post-merge (`lane-finish`), not here.
- **lane next** (design.md §5.2): run standalone, any time, to see which lanes (with an
  adopted baseline) fit the current Claude/Codex resource budget — not part of this
  skill's own flow, but useful before deciding to start new work.
- **spec_consensus** (design.md §5.3): woven into Phase 3->4 above (`lane consensus`).
- **knowledge** (design.md §5.4): woven into Phase 1->2 above (`lane knowledge-query` at
  spec/critic time); `lane knowledge-append` records a new lesson any time review turns
  one up, regardless of phase.

## Trigger keywords

- "move this lane forward" / "take it to PR" / "next phase"
- "write the spec" / "implement this" / "verify and open a PR" (phase confirmed via status)
- "start a lane for ..."
