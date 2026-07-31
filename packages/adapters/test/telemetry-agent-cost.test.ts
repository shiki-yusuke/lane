import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { AgentCostTelemetryAdapter, TelemetryImportFailed } from "../src/telemetry/agent-cost.js";

// Real integration test against the actual agent-cost binary (matching this repo's own
// convention — e.g. packages/core/test/differential — of preferring "run the real thing"
// over mocking a subprocess boundary). agent-cost is not yet published anywhere pip can
// resolve it from a bare `pip install agent-cost` (it's a sibling local repo), so CI does
// not yet have it on PATH; this is a known gap, not addressed here. Locally, it's resolved
// via LANE_TEST_AGENT_COST_BIN (point it at your own local install to run these), else
// PATH, and the whole suite is skipped if neither resolves.
function resolveAgentCostBin(): string | null {
  if (process.env.LANE_TEST_AGENT_COST_BIN) return process.env.LANE_TEST_AGENT_COST_BIN;
  try {
    execFileSync("agent-cost", ["--version"], { stdio: "ignore" });
    return "agent-cost";
  } catch {
    // not on PATH
  }
  return null;
}

const bin = resolveAgentCostBin();
const describeOrSkip = bin ? describe : describe.skip;

describeOrSkip("AgentCostTelemetryAdapter (real agent-cost subprocess)", () => {
  // agent-cost scans real local log files (~/.claude/projects, ~/.codex's state db) on
  // every call — observed anywhere from ~4s to ~25s across repeated runs on this dev
  // machine's accumulated history, bounded by --since/--until or not; the variance didn't
  // reliably correlate with bounding, so both tests below get generous headroom rather
  // than assuming a bounded call is fast.
  it("returns a matched:false session with zero totals for a session id that has no usage", async () => {
    const adapter = new AgentCostTelemetryAdapter({ bin: bin ?? undefined, timeoutMs: 90_000 });
    const result = await adapter.measure(["lane-test-nonexistent-session-id"]);
    expect(result.protocol_version).toBe("measure/v1");
    expect(result.session_ids).toEqual(["lane-test-nonexistent-session-id"]);
    expect(result.sessions["lane-test-nonexistent-session-id"]?.matched).toBe(false);
    expect(result.total.totals.tokens).toBe(0);
  }, 100_000);

  it("passes --since/--until/--agent through and still returns a well-formed response", async () => {
    const adapter = new AgentCostTelemetryAdapter({ bin: bin ?? undefined, timeoutMs: 60_000 });
    const result = await adapter.measure(["lane-test-nonexistent-session-id"], {
      since: new Date("2020-01-01T00:00:00Z"),
      until: new Date("2020-01-02T00:00:00Z"),
      agents: ["claude"],
    });
    expect(result.window.since).toContain("2020-01-01");
    expect(result.agent).toEqual(["claude"]);
  }, 70_000);

  it("rejects an empty session id list without ever spawning the subprocess", async () => {
    const adapter = new AgentCostTelemetryAdapter({ bin: bin ?? undefined });
    await expect(adapter.measure([])).rejects.toThrow(TelemetryImportFailed);
  });

  it("throws TelemetryImportFailed for a nonexistent binary", async () => {
    const adapter = new AgentCostTelemetryAdapter({ bin: "lane-nonexistent-binary-xyz" });
    await expect(adapter.measure(["s1"])).rejects.toThrow(TelemetryImportFailed);
  });
});
