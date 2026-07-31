import { describe, expect, it } from "vitest";
import { KnowledgeRecordSchema } from "../src/knowledge.js";

describe("KnowledgeRecordSchema refine invariants", () => {
  it("rejects a scope=scoped record with no paths and no path_prefixes", () => {
    const result = KnowledgeRecordSchema.safeParse({
      schema_version: "1.0",
      id: "kn-0010",
      summary: "no paths",
      created_at: "2026-07-31T09:00:00+09:00",
      scope: "scoped",
      repo_id: "example/example",
      type: "review_decision",
      context: "x",
      rationale: "x",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a scope=global record with no paths and no path_prefixes", () => {
    const result = KnowledgeRecordSchema.safeParse({
      schema_version: "1.0",
      id: "kn-0011",
      summary: "global, no paths needed",
      created_at: "2026-07-31T09:00:00+09:00",
      scope: "global",
      type: "review_decision",
      context: "x",
      rationale: "x",
    });
    expect(result.success).toBe(true);
  });
});
