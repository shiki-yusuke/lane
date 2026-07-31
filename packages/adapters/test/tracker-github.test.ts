import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GithubTrackerAdapter, TrackerOperationFailed } from "../src/tracker/github.js";

// Uses a recording test double instead of the real `gh` CLI (fixtures/
// fake-cli-recorder.mjs) — this suite must never post real comments on a real GitHub
// issue/PR. Argv construction is exactly what's under test here; gh's own CLI semantics
// are out of scope.
const __dirname = dirname(fileURLToPath(import.meta.url));
const fakeBin = join(__dirname, "fixtures", "fake-cli-recorder.mjs");

function readRecordedArgvCalls(recordFile: string): string[][] {
  return readFileSync(recordFile, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("GithubTrackerAdapter", () => {
  let recordFile: string;

  beforeEach(() => {
    recordFile = join(mkdtempSync(join(tmpdir(), "lane-tracker-test-")), "calls.jsonl");
    process.env.FAKE_CLI_RECORD_FILE = recordFile;
  });

  afterEach(() => {
    // `process.env.X = undefined` does NOT delete the var — Node's env proxy coerces the
    // assigned value to the string "undefined", which the fixture would then read back as
    // truthy. `delete` is required for real removal.
    // biome-ignore lint/performance/noDelete: see comment above
    delete process.env.FAKE_CLI_RECORD_FILE;
    // biome-ignore lint/performance/noDelete: see comment above
    delete process.env.FAKE_CLI_EXIT_CODE;
  });

  it("markStarted posts a comment via `gh issue comment <ref>`", async () => {
    const adapter = new GithubTrackerAdapter({ bin: fakeBin });
    await adapter.markStarted("42");
    expect(readRecordedArgvCalls(recordFile)).toEqual([
      ["issue", "comment", "42", "--body", "lane started working on this."],
    ]);
  });

  it("markDone uses the custom comment when provided, falling back to a default", async () => {
    const adapter = new GithubTrackerAdapter({ bin: fakeBin });
    await adapter.markDone("42", { comment: "custom note" });
    await adapter.markDone("43");
    expect(readRecordedArgvCalls(recordFile)).toEqual([
      ["issue", "comment", "42", "--body", "custom note"],
      ["issue", "comment", "43", "--body", "lane marked this done."],
    ]);
  });

  it("annotatePr formats section.title/body into a markdown comment on the PR", async () => {
    const adapter = new GithubTrackerAdapter({ bin: fakeBin });
    await adapter.annotatePr("7", { title: "Spec deviations", body: "none" });
    expect(readRecordedArgvCalls(recordFile)).toEqual([
      ["pr", "comment", "7", "--body", "### Spec deviations\n\nnone"],
    ]);
  });

  it("throws TrackerOperationFailed when the underlying command exits non-zero", async () => {
    process.env.FAKE_CLI_EXIT_CODE = "1";
    const adapter = new GithubTrackerAdapter({ bin: fakeBin });
    await expect(adapter.markStarted("42")).rejects.toThrow(TrackerOperationFailed);
  });
});
