import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ClaudeBudgetAdapter } from "../src/budget/claude-budget.js";

function fixturePath(dir: string, contents: unknown): string {
  const path = join(dir, "rate-limits.json");
  writeFileSync(path, JSON.stringify(contents));
  return path;
}

describe("ClaudeBudgetAdapter", () => {
  it("returns [] when the file doesn't exist (never fabricates a snapshot)", async () => {
    const adapter = new ClaudeBudgetAdapter({
      rateLimitsPath: "/nonexistent/rate-limits.json",
    });
    expect(await adapter.snapshot()).toEqual([]);
  });

  it("returns [] when the file is malformed JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lane-claude-budget-"));
    const path = join(dir, "rate-limits.json");
    writeFileSync(path, "{not json");
    const adapter = new ClaudeBudgetAdapter({ rateLimitsPath: path });
    expect(await adapter.snapshot()).toEqual([]);
  });

  it("returns measured snapshots for both metrics when written_at is fresh", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lane-claude-budget-"));
    const path = fixturePath(dir, {
      five_hour: { used_percentage: 42, resets_at: 1_900_000_000 },
      seven_day: { used_percentage: 68, resets_at: 1_900_100_000 },
      written_at: new Date().toISOString(),
    });
    const adapter = new ClaudeBudgetAdapter({ rateLimitsPath: path });
    const snapshots = await adapter.snapshot();
    expect(snapshots).toHaveLength(2);
    const fiveHour = snapshots.find((s) => s.metric === "rate_limit_5h");
    expect(fiveHour?.value).toBe(42);
    expect(fiveHour?.quality).toBe("measured");
    expect(fiveHour?.unit).toBe("percent_used");
    expect(fiveHour?.expiresAt?.getTime()).toBe(1_900_000_000 * 1000);
    const sevenDay = snapshots.find((s) => s.metric === "rate_limit_7d");
    expect(sevenDay?.value).toBe(68);
  });

  it("marks a snapshot stale when written_at is older than the TTL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lane-claude-budget-"));
    const staleWrittenAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    const path = fixturePath(dir, {
      five_hour: { used_percentage: 42, resets_at: null },
      written_at: staleWrittenAt,
    });
    const adapter = new ClaudeBudgetAdapter({ rateLimitsPath: path, staleAfterMs: 15 * 60 * 1000 });
    const snapshots = await adapter.snapshot();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.quality).toBe("stale");
  });

  it("marks a snapshot stale when written_at is missing entirely", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lane-claude-budget-"));
    const path = fixturePath(dir, { five_hour: { used_percentage: 10, resets_at: null } });
    const adapter = new ClaudeBudgetAdapter({ rateLimitsPath: path });
    const snapshots = await adapter.snapshot();
    expect(snapshots[0]?.quality).toBe("stale");
  });

  it("skips a metric whose used_percentage is null (not yet observed)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lane-claude-budget-"));
    const path = fixturePath(dir, {
      five_hour: { used_percentage: null, resets_at: null },
      seven_day: { used_percentage: 30, resets_at: null },
      written_at: new Date().toISOString(),
    });
    const adapter = new ClaudeBudgetAdapter({ rateLimitsPath: path });
    const snapshots = await adapter.snapshot();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.metric).toBe("rate_limit_7d");
  });
});
