import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrateLegacyKnowledge } from "../src/commands/migrate-legacy-knowledge.js";
import { listKnowledgeRecords } from "../src/knowledge-store.js";

function legacyRow(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    "Memory ID": "mem_example_001",
    Type: "review_decision",
    Summary: "Prefer logical CSS properties.",
    Detail: "Agreed in review.",
    Files: "src/example/Component.module.css",
    Tags: '["css"]',
    "date:Created:start": "2026-01-01",
    "PR URL": "https://github.com/example/example/pull/1",
    ...overrides,
  });
}

describe("runMigrateLegacyKnowledge", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "lane-migrate-knowledge-data-"));
    process.env.LANE_DATA_DIR = dataDir;
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: process.env.X = undefined coerces to the string "undefined", not real deletion
    delete process.env.LANE_DATA_DIR;
  });

  it("requires --repo-id", () => {
    const inputPath = join(
      mkdtempSync(join(tmpdir(), "lane-migrate-knowledge-src-")),
      "memories.jsonl",
    );
    writeFileSync(inputPath, legacyRow());
    const result = runMigrateLegacyKnowledge({ input: inputPath, repoId: "" });
    expect(result.exitCode).toBe(1);
  });

  it("fails cleanly when --input does not exist", () => {
    const result = runMigrateLegacyKnowledge({
      input: "/nonexistent/memories.jsonl",
      repoId: "example/example",
    });
    expect(result.exitCode).toBe(1);
  });

  it("imports valid rows and rejects invalid ones into a dedicated reject-report (not the knowledge dir itself)", () => {
    const srcDir = mkdtempSync(join(tmpdir(), "lane-migrate-knowledge-src2-"));
    const inputPath = join(srcDir, "memories.jsonl");
    const lines = [
      legacyRow({ "Memory ID": "mem-1" }),
      legacyRow({ "Memory ID": "mem-2", Type: "TODO" }),
      "{not json",
      legacyRow({ "Memory ID": "mem-3", Type: "unrecognized_legacy_type" }),
    ];
    writeFileSync(inputPath, lines.join("\n"));

    const result = runMigrateLegacyKnowledge({ input: inputPath, repoId: "example/example" });
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("imported 2");
    expect(result.message).toContain("rejected 2");
    expect(result.message).toContain("1 downgraded from review_finding-equivalent");

    const records = listKnowledgeRecords();
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.type === "review_decision")).toBe(true);
  });

  it("records legacy Type=TODO rows as unmapped (visible count) in the reject-report, not silently", () => {
    const srcDir = mkdtempSync(join(tmpdir(), "lane-migrate-knowledge-src5-"));
    const inputPath = join(srcDir, "memories.jsonl");
    writeFileSync(
      inputPath,
      [
        legacyRow({ "Memory ID": "mem-todo-1", Type: "TODO" }),
        legacyRow({ "Memory ID": "mem-2" }),
      ].join("\n"),
    );
    const rejectReportPath = join(dataDir, "reject-report.json");

    runMigrateLegacyKnowledge({ input: inputPath, repoId: "example/example", rejectReportPath });

    const report = JSON.parse(readFileSync(rejectReportPath, "utf-8"));
    expect(report.count).toBe(0);
    expect(report.unmapped_count).toBe(1);
    expect(report.unmapped).toHaveLength(1);
    expect(report.unmapped[0].reason).toContain("review_finding-equivalent");

    // the TODO row was still imported (as review_decision), not dropped
    expect(listKnowledgeRecords()).toHaveLength(2);
  });

  it("is idempotent: re-running on the same input does not duplicate records", () => {
    const srcDir = mkdtempSync(join(tmpdir(), "lane-migrate-knowledge-src3-"));
    const inputPath = join(srcDir, "memories.jsonl");
    writeFileSync(inputPath, legacyRow());

    runMigrateLegacyKnowledge({ input: inputPath, repoId: "example/example" });
    runMigrateLegacyKnowledge({ input: inputPath, repoId: "example/example" });
    expect(listKnowledgeRecords()).toHaveLength(1);
  });

  it("writes a reject-report.json with a reason for each rejected line", () => {
    const srcDir = mkdtempSync(join(tmpdir(), "lane-migrate-knowledge-src4-"));
    const inputPath = join(srcDir, "memories.jsonl");
    writeFileSync(inputPath, legacyRow({ Type: "unrecognized_legacy_type" }));
    const rejectReportPath = join(dataDir, "reject-report.json");

    runMigrateLegacyKnowledge({ input: inputPath, repoId: "example/example", rejectReportPath });

    const report = JSON.parse(readFileSync(rejectReportPath, "utf-8"));
    expect(report.count).toBe(1);
    expect(report.rejects[0].reason).toContain("unrecognized_legacy_type");
  });
});
