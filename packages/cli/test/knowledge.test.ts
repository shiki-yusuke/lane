import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runKnowledgeAppend, runKnowledgeQuery } from "../src/commands/knowledge.js";
import { listKnowledgeRecords } from "../src/knowledge-store.js";

describe("runKnowledgeAppend", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "lane-knowledge-append-data-"));
    process.env.LANE_DATA_DIR = dataDir;
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: process.env.X = undefined coerces to the string "undefined", not real deletion
    delete process.env.LANE_DATA_DIR;
  });

  it("requires --repo-id when --scope scoped", () => {
    const result = runKnowledgeAppend({
      type: "review_decision",
      scope: "scoped",
      summary: "x",
      context: "x",
      rationale: "x",
    });
    expect(result.exitCode).toBe(1);
  });

  it("requires taxonomy/evidence/resolution for --type review_finding", () => {
    const result = runKnowledgeAppend({ type: "review_finding", scope: "global", summary: "x" });
    expect(result.exitCode).toBe(1);
  });

  it("requires context/rationale for --type review_decision", () => {
    const result = runKnowledgeAppend({ type: "review_decision", scope: "global", summary: "x" });
    expect(result.exitCode).toBe(1);
  });

  it("appends a global review_decision record", () => {
    const result = runKnowledgeAppend({
      type: "review_decision",
      scope: "global",
      summary: "Prefer logical CSS properties.",
      context: "Reviewed in PR #1",
      rationale: "Better RTL support.",
    });
    expect(result.exitCode).toBe(0);
    const records = listKnowledgeRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.scope).toBe("global");
    expect(records[0]?.type).toBe("review_decision");
  });

  it("appends a scoped review_finding record with a caller-supplied id", () => {
    const result = runKnowledgeAppend({
      id: "k-test-001",
      type: "review_finding",
      scope: "scoped",
      repoId: "example/example",
      summary: "Race condition in step navigation.",
      paths: ["src/hooks/useStepNavigation.ts"],
      taxonomy: "test_missing",
      evidence: "No test covers the double-invoke case.",
      resolution: "deferred",
    });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("k-test-001");
    const records = listKnowledgeRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe("k-test-001");
    if (records[0]?.scope === "scoped") {
      expect(records[0].repo_id).toBe("example/example");
    }
    if (records[0]?.type === "review_finding") {
      expect(records[0].taxonomy).toBe("test_missing");
    }
  });
});

describe("runKnowledgeQuery", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "lane-knowledge-query-data-"));
    process.env.LANE_DATA_DIR = dataDir;
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: process.env.X = undefined coerces to the string "undefined", not real deletion
    delete process.env.LANE_DATA_DIR;
  });

  it("requires at least one --paths", () => {
    const result = runKnowledgeQuery({ paths: [] });
    expect(result.exitCode).toBe(1);
  });

  it("reports no matches when the knowledge store is empty", () => {
    const result = runKnowledgeQuery({ paths: ["src/x.ts"] });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("no matching knowledge records");
  });

  it("scores an exact path match at 1.00 and a prefix match lower, printing a pasteable knowledge_candidates block", () => {
    runKnowledgeAppend({
      type: "review_decision",
      scope: "global",
      summary: "Exact match record",
      context: "x",
      rationale: "x",
      paths: ["src/hooks/useStepNavigation.ts"],
    });
    runKnowledgeAppend({
      type: "review_finding",
      scope: "global",
      summary: "Prefix match record",
      taxonomy: "test_missing",
      evidence: "x",
      resolution: "deferred",
      paths: [],
      pathPrefixes: ["src/hooks"],
    });

    const result = runKnowledgeQuery({ paths: ["src/hooks/useStepNavigation.ts"] });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("score=1.00");
    expect(result.message).toContain("score=0.72");
    expect(result.message).toContain("knowledge_candidates");

    // the label itself contains a literal "[]" (per_lens[].knowledge_candidates), so the
    // JSON array's own opening bracket is found via "\n[" (start of its own line), not the
    // first "[" in the slice.
    const candidatesJson = result.message.slice(
      result.message.indexOf("knowledge_candidates (paste"),
    );
    const jsonStart = candidatesJson.indexOf("\n[") + 1;
    const parsed = JSON.parse(candidatesJson.slice(jsonStart));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].matched_by).toBe("path");
  });

  it("does not match a prefix across a segment boundary (src/foo must not match src/foobar)", () => {
    runKnowledgeAppend({
      type: "review_decision",
      scope: "global",
      summary: "Should not match",
      context: "x",
      rationale: "x",
      pathPrefixes: ["src/foo"],
    });
    const result = runKnowledgeQuery({ paths: ["src/foobar/thing.ts"] });
    expect(result.message).toContain("no matching knowledge records");
  });

  it("must-2: does not leak a scoped record from a different repo_id at the same relative path", () => {
    runKnowledgeAppend({
      id: "k-repo-a",
      type: "review_decision",
      scope: "scoped",
      repoId: "org/repo-a",
      summary: "repo-a's own lesson about src/index.ts",
      context: "x",
      rationale: "x",
      paths: ["src/index.ts"],
    });
    runKnowledgeAppend({
      id: "k-repo-b",
      type: "review_decision",
      scope: "scoped",
      repoId: "org/repo-b",
      summary: "repo-b's own, unrelated lesson about src/index.ts",
      context: "x",
      rationale: "x",
      paths: ["src/index.ts"],
    });

    const result = runKnowledgeQuery({ paths: ["src/index.ts"], repoId: "org/repo-a" });
    expect(result.message).toContain("k-repo-a");
    expect(result.message).not.toContain("k-repo-b");
    expect(result.message).toContain(
      'excluded 1 scope=scoped record(s) belonging to a different repo_id than "org/repo-a"',
    );
  });

  it("must-2: a global record still matches regardless of --repo-id", () => {
    runKnowledgeAppend({
      id: "k-global",
      type: "review_decision",
      scope: "global",
      summary: "cross-repo lesson",
      context: "x",
      rationale: "x",
      paths: ["src/index.ts"],
    });
    runKnowledgeAppend({
      id: "k-scoped-other",
      type: "review_decision",
      scope: "scoped",
      repoId: "org/other-repo",
      summary: "scoped to a different repo",
      context: "x",
      rationale: "x",
      paths: ["src/index.ts"],
    });
    const result = runKnowledgeQuery({ paths: ["src/index.ts"], repoId: "org/this-repo" });
    expect(result.message).toContain("k-global");
    expect(result.message).not.toContain("k-scoped-other");
  });

  it("must-2: excludes every scoped record and warns when repo context can't be determined at all", () => {
    runKnowledgeAppend({
      id: "k-scoped-x",
      type: "review_decision",
      scope: "scoped",
      repoId: "org/x",
      summary: "x",
      context: "x",
      rationale: "x",
      paths: ["src/index.ts"],
    });
    // repoId: null forces "undeterminable" explicitly (bypassing git-remote derivation,
    // which would otherwise make this test's outcome depend on the local checkout's
    // remote config) — this is the same code path a real repo with no --repo-id and no
    // resolvable git remote takes.
    const result = runKnowledgeQuery({ paths: ["src/index.ts"], repoId: null });
    expect(result.message).not.toContain("k-scoped-x");
    expect(result.message).toContain("could not determine repo context");
    expect(result.message).toContain("excluding 1 scope=scoped record(s)");
  });

  it("with --lens, also prints a knowledge_refs preview capped at 2 (per-lens max)", () => {
    for (let i = 0; i < 3; i++) {
      runKnowledgeAppend({
        id: `k-${i}`,
        type: "review_decision",
        scope: "global",
        summary: `record ${i}`,
        context: "x",
        rationale: "x",
        paths: ["src/shared.ts"],
      });
    }
    const result = runKnowledgeQuery({ paths: ["src/shared.ts"], lensId: "architecture" });
    expect(result.message).toContain('knowledge_refs preview for lens "architecture"');
    const previewJson = result.message.slice(result.message.lastIndexOf("["));
    const parsed = JSON.parse(previewJson);
    expect(parsed).toHaveLength(2); // PER_LENS_MAX, even though 3 records scored >= threshold
  });
});
