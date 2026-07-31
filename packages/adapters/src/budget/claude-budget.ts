import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BudgetAdapter, ResourceSnapshot } from "@lane/core";

// design.md §4.2/M3 — reads ~/.claude/rate-limits.json, the side-write statusline.sh now
// performs on every render (M3 item 1). This file's shape is owned by that dotfile, not by
// the schemas package: it's a personal, machine-local snapshot, not a data contract this
// repo ships or persists long-term, so it gets a plain shape check here rather than a zod
// schema + generated JSON Schema.

interface RateLimitField {
  used_percentage: number | null;
  resets_at: number | null; // Unix epoch seconds, matches statusline.sh's own convention
}

interface RateLimitsFile {
  five_hour?: RateLimitField;
  seven_day?: RateLimitField;
  written_at?: string; // ISO8601
}

function isRateLimitField(value: unknown): value is RateLimitField {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.used_percentage === null || typeof v.used_percentage === "number") &&
    (v.resets_at === null || typeof v.resets_at === "number")
  );
}

export interface ClaudeBudgetAdapterOptions {
  rateLimitsPath?: string;
  /**
   * TTL after which a rate-limits.json snapshot is treated as `quality: "stale"` rather
   * than `"measured"`. statusline.sh only rewrites this file while Claude Code is actively
   * rendering a statusline, so a gap bigger than this means the number could be from a
   * long-past, possibly very different session. Default 15 minutes.
   */
  staleAfterMs?: number;
}

const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000;

export class ClaudeBudgetAdapter implements BudgetAdapter {
  private readonly path: string;
  private readonly staleAfterMs: number;

  constructor(opts: ClaudeBudgetAdapterOptions = {}) {
    this.path = opts.rateLimitsPath ?? join(homedir(), ".claude", "rate-limits.json");
    this.staleAfterMs = opts.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  }

  // Implements the async BudgetAdapter port; this implementation happens to be synchronous
  // file I/O, but the interface must stay async so CodexBudgetAdapter (a real subprocess
  // call) can share it.
  async snapshot(): Promise<ResourceSnapshot[]> {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf-8");
    } catch {
      return []; // no data yet — never fabricate a snapshot from nothing
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return []; // malformed file (e.g. mid-write) — same "no usable data" treatment
    }
    const data = parsed as RateLimitsFile;

    const writtenAtMs = data.written_at ? Date.parse(data.written_at) : Number.NaN;
    const hasWrittenAt = !Number.isNaN(writtenAtMs);
    const isStale = !hasWrittenAt || Date.now() - writtenAtMs > this.staleAfterMs;
    const observedAt = hasWrittenAt ? new Date(writtenAtMs) : new Date(0);

    const snapshots: ResourceSnapshot[] = [];
    const fields: Array<[ResourceSnapshot["metric"], RateLimitField | undefined]> = [
      ["rate_limit_5h", data.five_hour],
      ["rate_limit_7d", data.seven_day],
    ];
    for (const [metric, field] of fields) {
      if (!isRateLimitField(field) || field.used_percentage == null) continue;
      snapshots.push({
        provider: "claude",
        metric,
        value: field.used_percentage,
        unit: "percent_used",
        observedAt,
        expiresAt: field.resets_at != null ? new Date(field.resets_at * 1000) : null,
        quality: isStale ? "stale" : "measured",
        source: this.path,
      });
    }
    return snapshots;
  }
}
