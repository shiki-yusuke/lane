import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GithubVcsAdapter, VcsOperationFailed } from "../src/vcs/github.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fakeGhBin = join(__dirname, "fixtures", "fake-cli-recorder.mjs");

function readRecordedArgvCalls(recordFile: string): string[][] {
  return readFileSync(recordFile, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// currentBranch/createBranch/commitAll exercise the *real* `git` binary against a
// throwaway temp repo (safe: nothing pushes anywhere) — this is the same "prefer the real
// thing over mocking" convention as the rest of this repo's adapter/differential tests.
// createPr uses the recording test double (fixtures/fake-cli-recorder.mjs) since it must
// never actually create a PR on a real GitHub repo.
describe("GithubVcsAdapter", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "lane-vcs-test-"));
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "lane-test@example.com"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "lane test"], { cwd: repoDir });
    writeFileSync(join(repoDir, "README.md"), "initial\n");
    execFileSync("git", ["add", "-A"], { cwd: repoDir });
    execFileSync("git", ["commit", "-q", "-m", "initial commit"], { cwd: repoDir });
  });

  it("currentBranch reports the real current git branch", async () => {
    const adapter = new GithubVcsAdapter();
    expect(await adapter.currentBranch(repoDir)).toBe("main");
  });

  it("createBranch checks out a new branch, then currentBranch reflects it", async () => {
    const adapter = new GithubVcsAdapter();
    await adapter.createBranch("lane/feature-x", repoDir);
    expect(await adapter.currentBranch(repoDir)).toBe("lane/feature-x");
  });

  it("commitAll stages and commits real changes", async () => {
    const adapter = new GithubVcsAdapter();
    writeFileSync(join(repoDir, "new-file.txt"), "content\n");
    await adapter.commitAll("add new-file.txt", repoDir);
    const log = execFileSync("git", ["log", "-1", "--format=%s"], {
      cwd: repoDir,
      encoding: "utf-8",
    });
    expect(log.trim()).toBe("add new-file.txt");
  });

  it("commitAll throws VcsOperationFailed when there is nothing to commit", async () => {
    const adapter = new GithubVcsAdapter();
    await expect(adapter.commitAll("empty commit attempt", repoDir)).rejects.toThrow(
      VcsOperationFailed,
    );
  });

  describe("createPr", () => {
    let recordFile: string;

    beforeEach(() => {
      recordFile = join(mkdtempSync(join(tmpdir(), "lane-vcs-pr-test-")), "calls.jsonl");
      process.env.FAKE_CLI_RECORD_FILE = recordFile;
      process.env.FAKE_CLI_STDOUT = "https://github.com/example/example/pull/42";
    });

    afterEach(() => {
      // `process.env.X = undefined` does NOT delete the var — Node's env proxy coerces
      // the assigned value to the string "undefined". `delete` is required for real removal.
      // biome-ignore lint/performance/noDelete: see comment above
      delete process.env.FAKE_CLI_RECORD_FILE;
      // biome-ignore lint/performance/noDelete: see comment above
      delete process.env.FAKE_CLI_STDOUT;
    });

    it("builds the expected gh pr create argv and parses the PR number from its stdout", async () => {
      const adapter = new GithubVcsAdapter({ ghBin: fakeGhBin });
      const result = await adapter.createPr(
        { branch: "lane/feature-x", base: "main", title: "Add feature x", body: "details" },
        repoDir,
      );
      expect(result).toEqual({ url: "https://github.com/example/example/pull/42", number: 42 });
      expect(readRecordedArgvCalls(recordFile)).toEqual([
        [
          "pr",
          "create",
          "--head",
          "lane/feature-x",
          "--title",
          "Add feature x",
          "--body",
          "details",
          "--base",
          "main",
        ],
      ]);
    });

    it("passes --draft through when requested", async () => {
      const adapter = new GithubVcsAdapter({ ghBin: fakeGhBin });
      await adapter.createPr(
        { branch: "lane/feature-x", title: "t", body: "b", draft: true },
        repoDir,
      );
      const [args] = readRecordedArgvCalls(recordFile);
      expect(args).toContain("--draft");
    });
  });
});
