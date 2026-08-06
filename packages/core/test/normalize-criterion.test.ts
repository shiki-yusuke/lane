import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeCriterion } from "../src/normalize-criterion.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface GoldenPair {
  input: string;
  output: string;
}

// Gate-port review (2026-08-06) — golden fixture generated from the private Python
// reference implementation's normalize_criterion v0.9.0 (see
// test/differential/generate-normalize-criterion-golden.py). Unlike the differential
// suite elsewhere in this package, this test has NO Python dependency and always runs in
// public CI: the fixture pairs are the frozen ground truth, checked in once, not
// recomputed against a live reference implementation on every run.
describe("normalizeCriterion (golden fixture from the Python reference implementation v0.9.0)", () => {
  const golden: GoldenPair[] = JSON.parse(
    readFileSync(join(__dirname, "fixtures", "normalize-criterion.golden.json"), "utf-8"),
  );

  it("fixture file is non-empty", () => {
    expect(golden.length).toBeGreaterThan(0);
  });

  it.each(golden.map((pair, i) => ({ ...pair, i })))(
    "case $i: $input -> $output",
    ({ input, output }) => {
      expect(normalizeCriterion(input)).toBe(output);
    },
  );
});
