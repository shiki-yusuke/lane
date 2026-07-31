import { describe, expect, it } from "vitest";
import { ImpactScanParseError, parseImpactScanBlock } from "../src/impact-scan.js";

function reportWithBlock(json: string): string {
  return [
    "# Impact Scan: something",
    "",
    "## 3. 直接影響ファイル",
    "some prose",
    "",
    "```impact-scan:v1",
    json,
    "```",
    "",
    "## 11. 人間確認が必要な点",
    "none",
    "",
  ].join("\n");
}

const validJson = JSON.stringify({
  scan_version: "1.0",
  repo_commit: "abc1234",
  candidate_paths: ["src/foo.ts", "src/bar.ts"],
  candidate_layers: ["domain", "presentation"],
  open_items: ["confirm forbidden_paths"],
});

describe("parseImpactScanBlock", () => {
  it("parses a well-formed block", () => {
    const snapshot = parseImpactScanBlock(reportWithBlock(validJson));
    expect(snapshot.scan_version).toBe("1.0");
    expect(snapshot.repo_commit).toBe("abc1234");
    expect(snapshot.candidate_paths).toEqual(["src/foo.ts", "src/bar.ts"]);
    expect(snapshot.candidate_layers).toEqual(["domain", "presentation"]);
    expect(snapshot.open_items).toEqual(["confirm forbidden_paths"]);
    expect(snapshot.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("defaults open_items to [] when absent", () => {
    const json = JSON.stringify({
      scan_version: "1.0",
      repo_commit: "abc1234",
      candidate_paths: ["src/foo.ts"],
      candidate_layers: ["domain"],
    });
    const snapshot = parseImpactScanBlock(reportWithBlock(json));
    expect(snapshot.open_items).toEqual([]);
  });

  it("always recomputes digest, ignoring any digest field embedded in the block", () => {
    const json = JSON.stringify({
      scan_version: "1.0",
      repo_commit: "abc1234",
      candidate_paths: ["src/foo.ts"],
      candidate_layers: ["domain"],
      digest: "stale-hand-edited-value",
    });
    const snapshot = parseImpactScanBlock(reportWithBlock(json));
    expect(snapshot.digest).not.toBe("stale-hand-edited-value");
  });

  it("produces the same digest for the same candidate_paths/candidate_layers regardless of scan_version/repo_commit", () => {
    const jsonA = JSON.stringify({
      scan_version: "1.0",
      repo_commit: "commit-a",
      candidate_paths: ["src/foo.ts"],
      candidate_layers: ["domain"],
    });
    const jsonB = JSON.stringify({
      scan_version: "2.0",
      repo_commit: "commit-b",
      candidate_paths: ["src/foo.ts"],
      candidate_layers: ["domain"],
    });
    expect(parseImpactScanBlock(reportWithBlock(jsonA)).digest).toBe(
      parseImpactScanBlock(reportWithBlock(jsonB)).digest,
    );
  });

  it("throws ImpactScanParseError when there is no block", () => {
    expect(() => parseImpactScanBlock("# Impact Scan\n\nno block here\n")).toThrow(
      ImpactScanParseError,
    );
  });

  it("throws ImpactScanParseError when there are two blocks (ambiguous)", () => {
    const report = `${reportWithBlock(validJson)}\n\`\`\`impact-scan:v1\n${validJson}\n\`\`\`\n`;
    expect(() => parseImpactScanBlock(report)).toThrow(ImpactScanParseError);
  });

  it("throws ImpactScanParseError for malformed JSON inside the block", () => {
    expect(() => parseImpactScanBlock(reportWithBlock("{not json"))).toThrow(ImpactScanParseError);
  });

  it("throws ImpactScanParseError when required fields are missing", () => {
    const json = JSON.stringify({ scan_version: "1.0" });
    expect(() => parseImpactScanBlock(reportWithBlock(json))).toThrow(ImpactScanParseError);
  });

  it("nit-8: accepts a fence with trailing whitespace after the tag", () => {
    const report = `# Impact Scan\n\n\`\`\`impact-scan:v1 \n${validJson}\n\`\`\`\n`;
    expect(() => parseImpactScanBlock(report)).not.toThrow();
  });

  it("nit-8: accepts a fence with trailing attributes after the tag", () => {
    const report = `# Impact Scan\n\n\`\`\`impact-scan:v1 some-attr=value\n${validJson}\n\`\`\`\n`;
    expect(() => parseImpactScanBlock(report)).not.toThrow();
  });

  it("nit-8: does not let a longer tag like impact-scan:v10 bleed into a v1 match", () => {
    const report = `# Impact Scan\n\n\`\`\`impact-scan:v10\n${validJson}\n\`\`\`\n`;
    expect(() => parseImpactScanBlock(report)).toThrow(ImpactScanParseError);
  });
});
