import { type KnowledgeRecord, KnowledgeRecordSchema } from "@lane/schemas";
import { describe, expect, it } from "vitest";
import { scoreKnowledgeRecord, selectKnowledgeRefs } from "../src/application/knowledge-service.js";

function decisionRecord(id: string, paths: string[], pathPrefixes: string[] = []): KnowledgeRecord {
  return KnowledgeRecordSchema.parse({
    schema_version: "1.0",
    id,
    paths,
    path_prefixes: pathPrefixes,
    summary: `record ${id}`,
    created_at: "2026-06-01T09:00:00+09:00",
    scope: "global",
    type: "review_decision",
    context: "x",
    rationale: "x",
  });
}

function findingRecord(
  id: string,
  pathPrefixes: string[],
  taxonomy = "test_missing" as const,
): KnowledgeRecord {
  return KnowledgeRecordSchema.parse({
    schema_version: "1.0",
    id,
    paths: [],
    path_prefixes: pathPrefixes,
    summary: `record ${id}`,
    created_at: "2026-06-01T09:00:00+09:00",
    scope: "global",
    type: "review_finding",
    taxonomy,
    evidence: "x",
    resolution: "deferred",
  });
}

describe("scoreKnowledgeRecord", () => {
  it("scores an exact path match at 1.00", () => {
    const record = decisionRecord("kn-1", ["src/foo.ts"]);
    const match = scoreKnowledgeRecord(record, ["src/foo.ts"]);
    expect(match).toEqual({ record, score: 1.0, matchedBy: "path" });
  });

  it("scores a path_prefix match on segment boundaries, not a naive startsWith", () => {
    const record = decisionRecord("kn-2", [], ["src/foo"]);
    expect(scoreKnowledgeRecord(record, ["src/foo/bar.ts"])?.matchedBy).toBe("path_prefix");
    expect(scoreKnowledgeRecord(record, ["src/foobar/baz.ts"])).toBeNull();
  });

  it("never qualifies a record on taxonomy alone", () => {
    const record = findingRecord("kn-3", []);
    expect(scoreKnowledgeRecord(record, ["src/unrelated.ts"], ["test_missing"])).toBeNull();
  });

  it("adds a taxonomy bonus on top of an existing path match", () => {
    const record = findingRecord("kn-4", ["src/foo"]);
    const withoutBonus = scoreKnowledgeRecord(record, ["src/foo/bar.ts"]);
    const withBonus = scoreKnowledgeRecord(record, ["src/foo/bar.ts"], ["test_missing"]);
    expect(withBonus?.score).toBeGreaterThan(withoutBonus?.score ?? 0);
  });
});

describe("selectKnowledgeRefs", () => {
  it("keeps at most 3 overall and at most 2 per lens, both conditions applied together", () => {
    const lensA = decisionRecord("a", ["p"]);
    const lensA2 = decisionRecord("a2", ["p"]);
    const lensA3 = decisionRecord("a3", ["p"]);
    const lensB = decisionRecord("b", ["p"]);
    const selected = selectKnowledgeRefs([
      {
        lensId: "lensA",
        matches: [
          { record: lensA, score: 1.0, matchedBy: "path" },
          { record: lensA2, score: 0.95, matchedBy: "path" },
          { record: lensA3, score: 0.9, matchedBy: "path" },
        ],
      },
      { lensId: "lensB", matches: [{ record: lensB, score: 0.8, matchedBy: "path" }] },
    ]);
    expect(selected.get("lensA")).toHaveLength(2); // capped per lens even though 3 were eligible
    expect(selected.get("lensB")).toHaveLength(1);
    const total = [...selected.values()].reduce((n, refs) => n + refs.length, 0);
    expect(total).toBeLessThanOrEqual(3);
  });

  it("drops anything below the 0.70 threshold", () => {
    const record = decisionRecord("below", ["p"]);
    const selected = selectKnowledgeRefs([
      { lensId: "lensA", matches: [{ record, score: 0.5, matchedBy: "path_prefix" }] },
    ]);
    expect(selected.get("lensA")).toBeUndefined();
  });
});
