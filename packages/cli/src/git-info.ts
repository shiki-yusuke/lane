import { execFileSync } from "node:child_process";

/** Current HEAD commit sha, or "unknown" if this isn't a git repo (or git isn't available). */
export function currentGitCommit(cwd: string): string {
  try {
    // stdio: "pipe" for stdout (captured via encoding), "ignore" for stderr — a lane
    // command running outside a git repo (e.g. a scratch spec-dir in a test) is an
    // expected, silently-handled case, not something that should print git's own
    // "fatal: not a git repository" onto this process's stderr.
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * "owner/repo" parsed from `git remote get-url origin`, or `null` if undeterminable (no
 * git repo, no `origin` remote, or a URL shape this doesn't recognize). Used to scope
 * `lane knowledge-query` to the current repo without ever guessing (must-2, Codex M3
 * review) — callers must treat `null` as "exclude every scoped record", never as "assume
 * global" or any other implicit default.
 */
export function deriveRepoIdFromGitRemote(cwd: string): string | null {
  let url: string;
  try {
    url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
  // Matches both "https://github.com/owner/repo.git" and "git@github.com:owner/repo.git"
  // (and either form without the trailing ".git") — host-agnostic, since this repo isn't
  // committed to GitHub specifically as the only possible remote host.
  const match = url.match(/[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) return null;
  const [, owner, repo] = match;
  if (!owner || !repo) return null;
  return `${owner}/${repo}`;
}
