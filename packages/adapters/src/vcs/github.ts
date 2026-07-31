import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CreatePrOptions, CreatedPr, VcsAdapter } from "@lane/core";

const execFileAsync = promisify(execFile);

export class VcsOperationFailed extends Error {}

export interface GithubVcsAdapterOptions {
  /** git binary, resolved via PATH by default. */
  gitBin?: string;
  /** gh binary, resolved via PATH by default. */
  ghBin?: string;
  timeoutMs?: number;
  /** git remote to push to. Defaults to "origin". */
  remote?: string;
}

async function run(
  bin: string,
  args: string[],
  opts: { timeoutMs: number; cwd: string },
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(bin, args, {
      timeout: opts.timeoutMs,
      cwd: opts.cwd,
      encoding: "utf-8",
    });
    return stdout;
  } catch (err) {
    throw new VcsOperationFailed(
      `${bin} ${args.join(" ")} (cwd=${opts.cwd}) failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Extracts the PR number from a `gh pr create` URL like https://github.com/o/r/pull/42. */
function prNumberFromUrl(url: string): number {
  const match = /\/pull\/(\d+)\s*$/.exec(url.trim());
  const number = match?.[1] ? Number(match[1]) : Number.NaN;
  if (Number.isNaN(number)) {
    throw new VcsOperationFailed(
      `could not parse a PR number out of gh pr create's output: ${url}`,
    );
  }
  return number;
}

// M2 addition (core/ports/vcs.ts) — thin wrapper around `git` (branch/commit/push) and
// `gh pr create` (PR creation), backing the "commit/push → PR 作成" step design.md's
// per-phase skill descriptions (§6) assume exists but design.md §4 never named a port for.
export class GithubVcsAdapter implements VcsAdapter {
  private readonly gitBin: string;
  private readonly ghBin: string;
  private readonly timeoutMs: number;
  private readonly remote: string;

  constructor(opts: GithubVcsAdapterOptions = {}) {
    this.gitBin = opts.gitBin ?? "git";
    this.ghBin = opts.ghBin ?? "gh";
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.remote = opts.remote ?? "origin";
  }

  async currentBranch(cwd: string): Promise<string> {
    const stdout = await run(this.gitBin, ["rev-parse", "--abbrev-ref", "HEAD"], {
      timeoutMs: this.timeoutMs,
      cwd,
    });
    return stdout.trim();
  }

  async createBranch(name: string, cwd: string): Promise<void> {
    await run(this.gitBin, ["checkout", "-b", name], { timeoutMs: this.timeoutMs, cwd });
  }

  async commitAll(message: string, cwd: string): Promise<void> {
    await run(this.gitBin, ["add", "-A"], { timeoutMs: this.timeoutMs, cwd });
    // git commit exits non-zero when there is nothing staged, which `run` turns into a
    // VcsOperationFailed — matching this method's documented "throws if nothing to
    // commit" contract without special-casing it here.
    await run(this.gitBin, ["commit", "-m", message], { timeoutMs: this.timeoutMs, cwd });
  }

  async push(branch: string, cwd: string): Promise<void> {
    await run(this.gitBin, ["push", "-u", this.remote, branch], { timeoutMs: this.timeoutMs, cwd });
  }

  async createPr(opts: CreatePrOptions, cwd: string): Promise<CreatedPr> {
    const args = [
      "pr",
      "create",
      "--head",
      opts.branch,
      "--title",
      opts.title,
      "--body",
      opts.body,
    ];
    if (opts.base) args.push("--base", opts.base);
    if (opts.draft) args.push("--draft");
    const stdout = await run(this.ghBin, args, { timeoutMs: this.timeoutMs, cwd });
    const url = stdout.trim().split("\n").at(-1) ?? "";
    return { url, number: prNumberFromUrl(url) };
  }
}
