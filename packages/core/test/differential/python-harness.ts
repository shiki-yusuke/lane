import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const harnessPath = join(__dirname, "python_harness.py");

/**
 * The Python interpreter used to run python_harness.py. Configurable (M4, Codex M3-review
 * follow-up item 3) so a machine with the private reference implementation installed under
 * a non-default interpreter (a venv, a specific pyenv version, etc.) can still run these
 * tests -- this repo itself never assumes a particular install location.
 */
const PYTHON_BIN = process.env.LANE_DIFFERENTIAL_PYTHON_BIN ?? "python3";

/**
 * Calls the real installed Python reference implementation package (v0.7.8) via
 * python_harness.py and returns its result. Throws if the Python side raised or the
 * harness rejected the function name.
 */
export function callPython<T = unknown>(fn: string, args: unknown[]): T {
  const stdout = execFileSync(PYTHON_BIN, [harnessPath], {
    input: JSON.stringify({ fn, args }),
    encoding: "utf-8",
  });
  const parsed = JSON.parse(stdout) as { result?: T; error?: string };
  if (parsed.error) {
    throw new Error(`python_harness.py: ${parsed.error}`);
  }
  return parsed.result as T;
}

let warnedAboutSkip = false;

/**
 * Whether the differential test suite can actually run right now (M4): explicitly
 * disabled via LANE_SKIP_DIFFERENTIAL_TESTS, or the private Python reference
 * implementation isn't importable at PYTHON_BIN. The reference implementation this repo
 * was ported from is not published anywhere the public can install it, so a fresh clone
 * (or CI without special setup) has no way to satisfy this -- differential tests skip
 * gracefully in that case rather than failing the whole suite (same
 * describe/describe.skip convention this repo already uses for real-subprocess tests
 * against agent-cost, e.g. packages/adapters/test/telemetry-agent-cost.test.ts).
 *
 * Codex M4 review, should-3: a skip is silent by default (vitest's own "N skipped" summary
 * line is easy to miss in CI output that also expects some tests to be skipped by design,
 * e.g. the real-subprocess adapter tests). Each call that resolves to "unavailable" also
 * prints a `::warning::` line -- GitHub Actions renders this as an actual annotation on
 * the job, not just scrollback text -- once per module load (each of the 4 differential
 * test files calls this once at module scope), so the parity suite being skipped is
 * something a maintainer would actually notice.
 */
export function isPythonReferenceAvailable(): boolean {
  const disabled = Boolean(process.env.LANE_SKIP_DIFFERENTIAL_TESTS);
  const available =
    !disabled &&
    (() => {
      try {
        execFileSync(PYTHON_BIN, ["-c", "import qureo_lane"], { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    })();
  if (!available && !warnedAboutSkip) {
    warnedAboutSkip = true;
    console.warn(
      "::warning::differential parity suite skipped — python reference implementation unavailable " +
        "(set LANE_DIFFERENTIAL_PYTHON_BIN to an interpreter that has it installed, or LANE_SKIP_DIFFERENTIAL_TESTS was set explicitly)",
    );
  }
  return available;
}
