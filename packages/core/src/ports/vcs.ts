// M2 addition, not in design.md's original §4 (Tracker/Telemetry/Budget only) — flagged to
// the team for confirmation. TrackerAdapter (§4.3) covers issue-tracking status (started/
// done/PR annotation) but has no operation for the actual git/PR mechanics (branch,
// commit, push, PR creation) that `lane verify`'s "commit/push → PR 作成" step (§6 skill
// description) needs. Split into its own port rather than folding into TrackerAdapter
// since a Tracker (issue status) and a Vcs (git/PR plumbing) are different concerns that
// could have different backing implementations (e.g. GitHub Issues + GitLab MRs).
export interface CreatePrOptions {
  branch: string;
  /** Defaults to the repo's default branch if omitted. */
  base?: string;
  title: string;
  body: string;
  draft?: boolean;
}

export interface CreatedPr {
  url: string;
  number: number;
}

export interface VcsAdapter {
  currentBranch(cwd: string): Promise<string>;
  createBranch(name: string, cwd: string): Promise<void>;
  /** Stages everything and commits; throws if there is nothing to commit. */
  commitAll(message: string, cwd: string): Promise<void>;
  push(branch: string, cwd: string): Promise<void>;
  createPr(opts: CreatePrOptions, cwd: string): Promise<CreatedPr>;
}
