import { describe, expect, it } from "vitest";
import { buildKnowledgeRecordFromLegacyMemory } from "../src/migrate-legacy-knowledge.js";

// Fixtures mirror the real column shape found in the salvaged review-memory export
// (a flattened Notion database export) during M2 implementation, with content replaced
// by generic placeholders per this repo's sanitize policy.

function row(overrides: Record<string, unknown> = {}) {
  return {
    "Memory ID": "mem_20260101_000000_example_001",
    Type: "review_decision",
    Summary: "Prefer logical CSS properties over physical ones.",
    Detail: "Agreed during review of PR #1.",
    Files: "src/example/Component.module.css",
    Tags: '["css","logical-properties"]',
    "date:Created:start": "2026-01-01",
    "date:Created:is_datetime": 0,
    "PR URL": "https://github.com/example/example/pull/1",
    ...overrides,
  };
}

describe("buildKnowledgeRecordFromLegacyMemory", () => {
  it("imports a review_decision row as type=review_decision", () => {
    const result = buildKnowledgeRecordFromLegacyMemory(row(), "example/example");
    expect("record" in result).toBe(true);
    if ("record" in result) {
      expect(result.record.type).toBe("review_decision");
      if (result.record.type === "review_decision") {
        expect(result.record.context).toContain("Review decision:");
        expect(result.record.rationale).toBe("Agreed during review of PR #1.");
      }
      expect(result.record.paths).toEqual(["src/example/Component.module.css"]);
      expect(result.record.tags).toEqual(["css", "logical-properties"]);
      expect(result.record.created_at).toBe("2026-01-01T00:00:00+09:00");
      expect(result.record.provenance).toBe("imported_legacy_memories");
    }
  });

  it("maps every legacy Type (TODO, spec_context, review_defer) to review_decision, never review_finding", () => {
    for (const type of ["TODO", "spec_context", "review_defer"]) {
      const result = buildKnowledgeRecordFromLegacyMemory(row({ Type: type }), "example/example");
      expect("record" in result, type).toBe(true);
      if ("record" in result) {
        expect(result.record.type).toBe("review_decision");
      }
    }
  });

  it("flags Type=TODO as downgradedFromFindingLike (unmapped review_finding equivalent), and no other Type", () => {
    for (const type of ["review_decision", "spec_context", "review_defer"]) {
      const result = buildKnowledgeRecordFromLegacyMemory(row({ Type: type }), "example/example");
      expect("record" in result, type).toBe(true);
      if ("record" in result) {
        expect(result.downgradedFromFindingLike, type).toBe(false);
      }
    }
    const todoResult = buildKnowledgeRecordFromLegacyMemory(
      row({ Type: "TODO" }),
      "example/example",
    );
    expect("record" in todoResult).toBe(true);
    if ("record" in todoResult) {
      expect(todoResult.downgradedFromFindingLike).toBe(true);
    }
  });

  it("uses scope=scoped with the given repoId when Files is non-empty", () => {
    const result = buildKnowledgeRecordFromLegacyMemory(row(), "example/example");
    if ("record" in result) {
      expect(result.record.scope).toBe("scoped");
      if (result.record.scope === "scoped") {
        expect(result.record.repo_id).toBe("example/example");
      }
    }
  });

  it("uses scope=global when Files is empty", () => {
    const result = buildKnowledgeRecordFromLegacyMemory(row({ Files: null }), "example/example");
    if ("record" in result) {
      expect(result.record.scope).toBe("global");
    }
  });

  it("splits a comma-separated Files column into multiple paths", () => {
    const result = buildKnowledgeRecordFromLegacyMemory(
      row({ Files: "a.ts, b.ts,  c.ts" }),
      "example/example",
    );
    if ("record" in result) {
      expect(result.record.paths).toEqual(["a.ts", "b.ts", "c.ts"]);
    }
  });

  it("rejects an unrecognized Type", () => {
    const result = buildKnowledgeRecordFromLegacyMemory(
      row({ Type: "some_new_type_not_seen_before" }),
      "example/example",
    );
    expect("reject" in result).toBe(true);
  });

  it("rejects a missing Type", () => {
    const result = buildKnowledgeRecordFromLegacyMemory(row({ Type: null }), "example/example");
    expect("reject" in result).toBe(true);
  });

  it("rejects a missing Summary", () => {
    const result = buildKnowledgeRecordFromLegacyMemory(row({ Summary: null }), "example/example");
    expect("reject" in result).toBe(true);
  });

  it("rejects malformed input that doesn't match the expected row shape", () => {
    const result = buildKnowledgeRecordFromLegacyMemory({ "Memory ID": 123 }, "example/example");
    expect("reject" in result).toBe(true);
  });

  it("tolerates malformed Tags JSON without failing the whole record", () => {
    const result = buildKnowledgeRecordFromLegacyMemory(
      row({ Tags: "not-json" }),
      "example/example",
    );
    expect("record" in result).toBe(true);
    if ("record" in result) {
      expect(result.record.tags).toEqual([]);
    }
  });
});
