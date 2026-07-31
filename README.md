# lane

A local-first delivery-lane orchestrator: it drives a change through Intent -> Spec/Critic
-> Implement -> Verify -> Done, stopping at defined gates for a human to decide, and layers
four evolved features on top — cost/effort estimation with calibration against real usage,
a resource-aware "what should I work on next" view, a spec-consensus hard gate, and a
knowledge-DB lens for review lessons.

This is a from-scratch TypeScript rewrite of a private Python tool the author built and
used personally; the source project has no public existence, so this repo stands on its
own.

## Install

Requires Node.js >= 22.

```bash
npm install -g spec-lane
lane --version
```

### From source (for contributing to `lane` itself)

Requires [pnpm](https://pnpm.io/) too (`corepack enable` gets you `pnpm` on a recent Node
without a separate install). This checkout is a pnpm workspace of four `@lane/*` packages
(`schemas`/`core`/`adapters`/`cli`) that `pnpm -r run build` compiles independently — the
published `spec-lane` package above is instead a single self-contained bundle produced by
`node scripts/build-publish.mjs` from that same source (see that script's header comment for
why); you don't need to know about the bundle step to work on `lane` day to day.

```bash
git clone https://github.com/shiki-yusuke/lane.git
cd lane
pnpm install
pnpm -r run build
```

Make the `lane` command available globally from this checkout:

```bash
cd packages/cli
npm link
cd ../..
lane --version
```

(`npm link` creates a symlink from your global npm bin dir to this checkout's built CLI —
uninstall any time with `npm unlink -g @lane/cli`. If you'd rather not touch your global
npm state, invoke it directly instead: `node packages/cli/dist/main.js <command>`.)

### Optional: agent-cost, for cost calibration and the resource view

`lane calibrate` and the Codex side of `lane next` call out to
[agent-cost](https://github.com/shiki-yusuke/agent-cost), a separate CLI that reads local
Claude Code / Codex CLI logs to measure real token usage and cost. `lane estimate` itself
never calls it — it only ever reads the local calibration population that `lane calibrate`
has already written. Install agent-cost (see that repo's own README) and make sure
`agent-cost` resolves on PATH, or pass `--agent-cost-bin <path>` to the commands that need
it. Without it, everything else in `lane` still works — you just won't have real usage
numbers to calibrate against.

## Quick start

Run these from the root of whatever repo you want to manage lanes for (`lane` looks for
`docs/spec/` relative to your current directory by default — see "Configuration" below).

```bash
# 1. Start a new lane
lane start I-2026-01-15-my-first-change \
  --business-goal "Reduce onboarding friction in the setup flow." \
  --user-visible-intent "New users see setup steps in the right order." \
  --primary-user "new_user" \
  --risk low

# 2. Check where it is
lane status I-2026-01-15-my-first-change

# 3. Write docs/spec/I-2026-01-15-my-first-change/spec.md and critic.yaml yourself
#    (or have your AI agent do it — see skills/lane/SKILL.md), then:
lane validate I-2026-01-15-my-first-change
lane advance I-2026-01-15-my-first-change --phase 2_spec

# 4. Implement the change (branch, real code + tests), then:
lane advance I-2026-01-15-my-first-change --phase 3_implement

# 5. Write verification.yaml, resolve spec_consensus:
lane consensus I-2026-01-15-my-first-change --refresh --spec-ssot-ref docs/spec-impact/specs/example.md
lane consensus I-2026-01-15-my-first-change --ack --reviewer-kind self --reviewer-id you
lane advance I-2026-01-15-my-first-change --phase 4_verify

# 6. Open a PR, get it merged, then:
lane advance I-2026-01-15-my-first-change --phase 5_done \
  --merged-at 2026-01-16T09:00:00Z --pr-url https://github.com/you/your-repo/pull/1
```

**Caveat:** `lane validate` before Phase 4 only checks `intent.yaml` (always) and
`critic.yaml` (if it exists yet). It never checks `spec.md`'s own content, and the
`spec_consensus` hard gate (the thing `lane consensus` builds up) is only evaluated once
you reach Phase 4 — a lane can validate cleanly at 1_intent/2_spec/3_implement while still
having spec_consensus completely unfilled.

Run `lane <command> --help` for every flag a command accepts. If you're driving `lane`
through an AI coding agent rather than by hand, point it at `skills/lane/SKILL.md` (Phase
1-4) and `skills/lane-finish/SKILL.md` (post-merge Phase 5) — they describe the same flow
above in a form meant for an agent to follow directly.

## The four features

1. **Estimate / calibrate** — `lane estimate <id> [--impact-scan-file <report.md>] [--adopt]`
   predicts token/cost usage (p50/p80) from a k-NN model over past measured work, always
   labeled with how much to trust it (`experimental` below a 30-observation population,
   `reference_table` fallback below 8). `lane calibrate <id> --session-id <id>` measures
   what a lane's work actually cost (via agent-cost) and, if a baseline was adopted, scores
   the prediction against reality — feeding the next estimate's population.
2. **`lane next`** — a decision table of every lane with an adopted baseline estimate
   against your current Claude/Codex resource snapshots (`~/.claude/rate-limits.json` via
   your Claude Code statusline, and a manually-configured weekly Codex credit budget). It
   only ever shows `fits`/`not_fit` when the predicted cost and a budget constraint share
   the exact same unit — no invented USD-to-credits conversion — and suppresses every
   verdict (showing only raw numbers) when the underlying data is stale or incompletely
   priced.
3. **`spec_consensus`** — a hard gate (`lane consensus`) that blocks reaching Phase 5 until
   every deviation between the spec and what was actually built is recorded and resolved,
   and a reviewer has acknowledged the current spec/verification content by content hash
   (an edit after the ack invalidates it automatically).
4. **Knowledge** — `lane knowledge-append`/`lane knowledge-query` is a small, deterministic
   lessons-learned database: append a finding or decision once, and future lanes touching
   the same paths get it surfaced (score >= 0.70, top 3 overall, max 2 per review lens) as
   `knowledge_candidates` your spec/critic review can cite.

See `docs/design.md` for the full design rationale behind each of these.

## Configuration

| What | Default | Override |
|---|---|---|
| Where lane specs live | `docs/spec/` under your current directory | `--spec-dir <path>` or `$LANE_SPEC_DIR` |
| Runtime data (knowledge records, calibration observations, done overlays) | `$XDG_DATA_HOME/lane` (usually `~/.local/share/lane`) | `$LANE_DATA_DIR` |
| Config (Codex budget file) | `$XDG_CONFIG_HOME/lane` (usually `~/.config/lane`) | `$LANE_CONFIG_DIR` |
| Profile (risk rules, required commands, distance caps, etc.) | the bundled `profiles/generic.profile.yaml` | `--profile <id-or-path>` > `$LANE_PROFILE_PATH` > a `profiles-local/<id>.yaml` in your repo |

### Codex budget file (for `lane next`)

If you want `lane next` to show a Codex credit budget, create
`$LANE_CONFIG_DIR/budgets/codex.yaml`:

```yaml
weekly_limit_credits: 15000
period_start: "2026-01-12"
period_end: "2026-01-19" # exclusive boundary, must be exactly 7 days after period_start for reset_rule=weekly
reset_rule: "weekly"
timezone: "Asia/Tokyo" # v1 supports Asia/Tokyo and UTC only
```

Without this file, `lane next` simply has no Codex row to show — it never fabricates one.

## Data directory and privacy

Runtime data (`$LANE_DATA_DIR`: knowledge records, calibration observations, done overlays)
and config (`$LANE_CONFIG_DIR`) both live **outside this repository** by design (XDG Base
Directory convention) — cloning or publishing this repo never carries your own knowledge
base or calibration history along with it. The one-time importer commands
(`migrate-legacy-ledger`, `migrate-legacy-knowledge`) that backfill a calibration/knowledge
population from old data explicitly warn on every run that imported records may retain
internal references (PR URLs, ticket-shaped text, etc.) from whatever you imported them
from — imported records are tagged `provenance: "imported_legacy_ledger"` /
`"imported_legacy_memories"`, which is the one mechanical key to filter them out if you
ever need to share your data directory with someone else.

## Development

```bash
pnpm -r run typecheck   # all packages
pnpm -r run build       # tsc project references
pnpm run lint           # biome check .
pnpm -r run test        # vitest, all packages
pnpm exec dependency-cruiser --config .dependency-cruiser.cjs packages/schemas/src packages/core/src packages/adapters/src packages/cli/src
```

Monorepo layout: `packages/schemas` (zod schemas + generated JSON Schema, no internal
deps) -> `packages/core` (pure application logic + port interfaces) -> `packages/adapters`
(port implementations: GitHub via `gh`, agent-cost via subprocess) -> `packages/cli`
(commander.js wiring). Dependency direction is enforced by `.dependency-cruiser.cjs` and
checked in CI.

### A note on `packages/core/test/differential`

A handful of core functions (ledger derivation, phase transitions, the done overlay, and
the Goodhart personal-dimension guard) were ported byte-for-byte from a private Python
reference implementation this project is based on, and are checked against it via a
differential test suite that calls that Python package as a subprocess. That package isn't
published anywhere you can install it from — these tests skip automatically
(`isPythonReferenceAvailable()` in `python-harness.ts`) when it isn't importable, which is
the normal case for anyone outside the original author. Nothing else in this repo depends
on it.

## License

[MIT](LICENSE)
