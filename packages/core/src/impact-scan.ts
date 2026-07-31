import { type ImpactScanSnapshot, ImpactScanSnapshotSchema } from "@lane/schemas";
import { computeDigest } from "./digest.js";

// design.md §2.6/§5.1/M2 item 6 — parses a structured "impact-scan:v1" block out of an
// impact-scan report (design.md's ImpactScanSnapshot). The block *convention* (fenced code
// block tagged `impact-scan:v1` containing a JSON object) was originally drafted here as a
// provisional lane-side spec, then formally adopted (2026-07-31) with its canonical
// definition moved to ai-agent-skills-playbook's pre-implementation-impact-scan skill
// ("Structured output block (impact-scan:v1)" section in that skill's SKILL.md). This file
// is a consumer of that spec, not the source of truth for it — if the block shape ever
// changes, the playbook doc is what governs, and this parser follows.
//
// Per the playbook spec, the block itself never carries a `digest` field at all; `digest`
// is always computed here from candidate_paths+candidate_layers, so a stale or hand-edited
// digest can never silently pass validation.

const IMPACT_SCAN_FENCE_TAG = "impact-scan:v1";

interface RawImpactScanBlock {
  scan_version: string;
  repo_commit: string;
  candidate_paths: string[];
  candidate_layers: string[];
  open_items?: string[];
}

export class ImpactScanParseError extends Error {}

function computeSnapshotDigest(
  candidatePaths: readonly string[],
  candidateLayers: readonly string[],
): string {
  return computeDigest(
    JSON.stringify({ candidate_paths: candidatePaths, candidate_layers: candidateLayers }),
  );
}

/**
 * Finds every fenced code block whose info string *starts with* `impact-scan:v1` in
 * `markdown` (e.g. "```impact-scan:v1", but also "```impact-scan:v1 " with trailing
 * whitespace, or "```impact-scan:v1 some-attr=value" — nit-8, M2 review, 2026-07-31: the
 * playbook spec doesn't forbid a producer from appending trailing info-string content, and
 * this parser shouldn't reject a block just for that). Returns their raw contents in
 * document order.
 */
function extractFencedBlocks(markdown: string, tag: string): string[] {
  const escapedTag = tag.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
  // (?![\w-]) keeps a future "impact-scan:v10" tag from bleeding into a "v1" match: the
  // trailing-content tolerance is for whitespace/attributes after the *whole* tag token,
  // not for accepting a longer tag name that merely starts the same.
  const pattern = new RegExp(`\`\`\`${escapedTag}(?![\\w-])[^\\n]*\\r?\\n([\\s\\S]*?)\`\`\``, "g");
  const blocks: string[] = [];
  for (const match of markdown.matchAll(pattern)) {
    blocks.push(match[1] ?? "");
  }
  return blocks;
}

/**
 * Parses exactly one impact-scan:v1 block out of a report. Throws ImpactScanParseError if
 * there is none, more than one (ambiguous — which one is authoritative?), or the JSON
 * inside doesn't have the required fields.
 */
export function parseImpactScanBlock(markdown: string): ImpactScanSnapshot {
  const blocks = extractFencedBlocks(markdown, IMPACT_SCAN_FENCE_TAG);
  if (blocks.length === 0) {
    throw new ImpactScanParseError(`no \`\`\`${IMPACT_SCAN_FENCE_TAG} block found in the report`);
  }
  if (blocks.length > 1) {
    throw new ImpactScanParseError(
      `found ${blocks.length} \`\`\`${IMPACT_SCAN_FENCE_TAG} blocks; exactly one is expected`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(blocks[0] ?? "");
  } catch (err) {
    throw new ImpactScanParseError(
      `impact-scan:v1 block is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (typeof raw !== "object" || raw === null) {
    throw new ImpactScanParseError("impact-scan:v1 block must be a JSON object");
  }
  const candidate = raw as Partial<RawImpactScanBlock>;
  if (
    typeof candidate.scan_version !== "string" ||
    typeof candidate.repo_commit !== "string" ||
    !Array.isArray(candidate.candidate_paths) ||
    !Array.isArray(candidate.candidate_layers)
  ) {
    throw new ImpactScanParseError(
      "impact-scan:v1 block must have scan_version, repo_commit, candidate_paths[], candidate_layers[]",
    );
  }

  const openItems = Array.isArray(candidate.open_items) ? candidate.open_items : [];
  const digest = computeSnapshotDigest(candidate.candidate_paths, candidate.candidate_layers);

  return ImpactScanSnapshotSchema.parse({
    scan_version: candidate.scan_version,
    repo_commit: candidate.repo_commit,
    candidate_paths: candidate.candidate_paths,
    candidate_layers: candidate.candidate_layers,
    open_items: openItems,
    digest,
  });
}
