// design.md §4.3 — Tracker port. M1 ships this interface only; GithubTrackerAdapter
// (gh CLI) is M2 (design.md §1 non-scope / §4.3: annotatePr's PR-body editing is
// deferred past M2 too, per §8 v1 scope reduction).
export interface TrackerAdapter {
  markStarted(ref: string): Promise<void>;
  markDone(ref: string, opts?: { comment?: string }): Promise<void>;
  annotatePr(prRef: string, section: { title: string; body: string }): Promise<void>;
}
