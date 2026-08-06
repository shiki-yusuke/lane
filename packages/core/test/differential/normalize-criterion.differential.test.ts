import { describe, expect, it } from "vitest";
import { normalizeCriterion } from "../../src/normalize-criterion.js";
import { callPython, isPythonReferenceAvailable } from "./python-harness.js";

// Gate-port review (2026-08-06) — skips gracefully without the private Python reference
// implementation installed locally (see python-harness.ts's isPythonReferenceAvailable
// doc comment). test/normalize-criterion.test.ts (the golden-fixture test, no Python
// dependency) is what public CI actually runs; this suite is the maintainer-only
// live-parity check against qureo_lane.validate.normalize_criterion (v0.9.0) itself.
const describeOrSkip = isPythonReferenceAvailable() ? describe : describe.skip;

describeOrSkip(
  "normalizeCriterion matches the Python reference implementation's normalize_criterion (v0.9.0)",
  () => {
    const cases = [
      "hello world",
      "新しい ユーザー が セットアップ を完了する",
      "新しい　ユーザー　が　セットアップ　を完了する",
      "See [issue-123](https://example.com/123) for details",
      "**bold** and *italic* and `code`",
      "\u{1F389} Done! \u{1F389}",
      "**[Rule 1](https://x.com/1)**: ユーザー　が `完了` する \u{1F389}",
      "",
      "   　  ",
      "alreadynormalized",
      "[A](url1) and [B](url2)",
      "text [not a link",
      "New user completes setup within 5 minutes.",
      "\t\ttab\tand\nnewline\n",
    ];
    for (const [i, text] of cases.entries()) {
      it(`case #${i}: ${JSON.stringify(text)}`, () => {
        const expected = callPython<string>("normalize_criterion", [text]);
        expect(normalizeCriterion(text)).toBe(expected);
      });
    }
  },
);
