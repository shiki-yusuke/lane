import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TrackerAdapter } from "@lane/core";

const execFileAsync = promisify(execFile);

export class TrackerOperationFailed extends Error {}

export interface GithubTrackerAdapterOptions {
  /** Binary name (resolved via PATH) or absolute path. Defaults to "gh". */
  bin?: string;
  timeoutMs?: number;
  cwd?: string;
}

async function run(
  bin: string,
  args: string[],
  opts: { timeoutMs: number; cwd?: string },
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(bin, args, {
      timeout: opts.timeoutMs,
      cwd: opts.cwd,
      encoding: "utf-8",
    });
    return stdout;
  } catch (err) {
    throw new TrackerOperationFailed(
      `${bin} ${args.join(" ")} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// design.md §4.3 — GithubTrackerAdapter via `gh` CLI. GitHub Issues have no built-in
// "in progress"/"done" state machine (unlike Linear), so markStarted/markDone are
// implemented as issue comments rather than a status transition. annotatePr posts a
// separate PR comment rather than editing the PR body in place — design.md §5.3/§8
// explicitly defers *in-place* PR body editing past v1; a comment still gives the same
// visible "spec vs. implementation" note without that.
export class GithubTrackerAdapter implements TrackerAdapter {
  private readonly bin: string;
  private readonly timeoutMs: number;
  private readonly cwd: string | undefined;

  constructor(opts: GithubTrackerAdapterOptions = {}) {
    this.bin = opts.bin ?? "gh";
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.cwd = opts.cwd;
  }

  async markStarted(ref: string): Promise<void> {
    await run(this.bin, ["issue", "comment", ref, "--body", "lane started working on this."], {
      timeoutMs: this.timeoutMs,
      cwd: this.cwd,
    });
  }

  async markDone(ref: string, opts?: { comment?: string }): Promise<void> {
    await run(
      this.bin,
      ["issue", "comment", ref, "--body", opts?.comment ?? "lane marked this done."],
      {
        timeoutMs: this.timeoutMs,
        cwd: this.cwd,
      },
    );
  }

  async annotatePr(prRef: string, section: { title: string; body: string }): Promise<void> {
    const body = `### ${section.title}\n\n${section.body}`;
    await run(this.bin, ["pr", "comment", prRef, "--body", body], {
      timeoutMs: this.timeoutMs,
      cwd: this.cwd,
    });
  }
}
