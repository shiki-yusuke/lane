import { describe, expect, it } from "vitest";
import { matchesGlob, matchesPathPrefixSegments } from "../src/glob.js";

describe("matchesGlob", () => {
  it("matches ** across any number of segments", () => {
    expect(matchesGlob(".github/workflows/**", ".github/workflows/ci.yml")).toBe(true);
    expect(matchesGlob(".github/workflows/**", ".github/workflows/nested/ci.yml")).toBe(true);
    expect(matchesGlob("**/migration*", "src/db/migration_001.sql")).toBe(true);
  });

  it("does not match outside the pattern's scope", () => {
    expect(matchesGlob(".github/workflows/**", "src/index.ts")).toBe(false);
  });

  it("* matches within a single segment only", () => {
    expect(matchesGlob("src/*.ts", "src/index.ts")).toBe(true);
    expect(matchesGlob("src/*.ts", "src/nested/index.ts")).toBe(false);
  });
});

describe("matchesPathPrefixSegments", () => {
  it("matches on segment boundaries", () => {
    expect(matchesPathPrefixSegments("src/foo", "src/foo/bar.ts")).toBe(true);
    expect(matchesPathPrefixSegments("src/foo", "src/foo")).toBe(true);
  });

  it("does not match a same-prefix-string sibling directory (design.md §5.4)", () => {
    expect(matchesPathPrefixSegments("src/foo", "src/foobar/baz.ts")).toBe(false);
  });
});
