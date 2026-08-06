# Changelog

All notable changes to `lane`/`spec-lane` are documented here. This project is pre-1.0
(alpha); breaking changes between minor releases are expected and are not accompanied by a
deprecation period.

## 0.2.0

Gate-port review: ports two more of the private reference implementation's gates
(premise-evidence and success-criteria checks), calibrated against 10 real pilot
lanes before this port, with none of the pilot's thresholds or fail/warning
classifications changed.

### Gate foundation refactor

- `GateResult` (`{pass:true} | {pass:false, reason}`) is replaced by `Diagnostic[]`
  (`{gateId, code, severity: "warning"|"error", message}`), so a single gate can report
  more than one simultaneous finding instead of stopping at the first.
- `GateContext`'s flat `{phase, targetPhase, event}` is replaced by a discriminated
  `GateTrigger` union: `{type:"phase_advance", from, to} | {type:"before_pr_publish", phase}`.
- `evaluateGates` no longer short-circuits on the first failing gate; it collects
  diagnostics from every gate that applies.
- `lane advance` now runs "validity check -> read artifacts -> evaluate gates -> update
  state" on **every** transition, not just the `5_done` one, and leaves lane-state.json
  completely untouched if any gate reports an error.
- `lane validate` drops the "skip all gate evaluation below `4_verify`" early return; it
  now evaluates both the forward transition edge from wherever the lane currently sits and
  the standalone `before_pr_publish` checkpoint, so early-phase gates are reachable without
  first attempting (and having blocked) a real `advance`.

### New gates

- **premise_evidence** (`1_intent` -> `2_spec`): if a change is AI-originated or the
  symptom was never directly observed, and it introduces a new guard/branch/completion
  condition, the premise's real-world existence must be confirmed (live observation,
  existing data, or at minimum a static code trace) and recorded in `intent.yaml`'s new
  `premise_evidence` field before drafting spec.md. Unrecorded is a warning (the CLI cannot
  itself decide whether a change needed the check); `required:true` with
  `reproduced:false` is a hard error.
- **success_criteria** (`3_implement` -> `4_verify`, and a standing `before_pr_publish`
  double-check): every line of `intent.intent.success` must be cross-checked against the
  final diff, in both directions, and recorded in `verification.yaml`'s new
  `success_criteria_matrix`. `covered_by: "none"` is a hard error; a criterion with no
  corresponding `intent.success` line is a warning (spec/verification grew a stronger
  condition than the SSOT states). Matching is exact, normalized-text equality
  (`normalizeCriterion`, absorbing markdown links/emphasis/whitespace only) -- never fuzzy
  similarity.

### Schema additions

- `IntentSchema.premise_evidence` (optional, discriminated union on `required`).
- `VerificationSchema.success_criteria_matrix` / `cross_check_intent_vs_spec` (both
  optional).
- `canonicalVerificationContent()` (the content `spec_consensus`'s digest binds a reviewer
  ack to) now includes both new fields -- editing `success_criteria_matrix` after an ack
  now invalidates it, the same as editing any other verification content already did.

### Skill

- `skills/lane/SKILL.md` weaves premise-evidence confirmation into the lane-start step
  (before spec.md, not after), a dependency/path cross-check into the spec.md step (with
  its own human-review-approval gate and a 3-blind-spot disclaimer), an independent
  re-search obligation into `critic.yaml`'s `test_coverage` lens, and the
  success-criteria cross-check plus a fixed ordering (cross-check -> consensus refresh/ack
  -> validate -> advance -> no further spec/verification/critic edits) into the
  `3_implement` step.

## 0.1.0

Initial public release: a from-scratch TypeScript rewrite of a private Python delivery-lane
orchestrator, driving a change through Intent -> Spec/Critic -> Implement -> Verify -> Done
with human-decision gates, plus four features layered on top of the original tool's own
scope -- cost/effort estimation with calibration against real usage, a resource-aware
"what should I work on next" view, a `spec_consensus` hard gate binding reviewer
acknowledgement to exact content by digest, and a knowledge-DB lens surfacing past review
lessons for files a new change touches.
