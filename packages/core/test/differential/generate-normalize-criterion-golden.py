#!/usr/bin/env python3
"""Regenerates test/fixtures/normalize-criterion.golden.json from the private Python
reference implementation's normalize_criterion (v0.9.0). Maintainer-only tooling: requires
that reference implementation installed locally (same requirement as
python_harness.py's differential tests) -- public CI never runs this script, it only
reads the committed golden file (test/normalize-criterion.test.ts is a plain unit test
with no Python dependency).

Usage: python3 packages/core/test/differential/generate-normalize-criterion-golden.py
"""
import json
import sys
from pathlib import Path

from qureo_lane.validate import normalize_criterion

# Covers: plain ASCII spaces, Japanese text with ASCII spaces, Japanese text with
# full-width (U+3000) spaces, a markdown link, bold/italic/backtick emphasis, emoji
# (codepoint-preserving, unrelated to the separate UTF-16-vs-codepoint-length concern that
# only applies to premise_evidence.evidence's length check), all of the above combined,
# empty/whitespace-only strings, an already-normalized string, multiple links, an
# unterminated-looking bracket that is not actually a markdown link, a realistic
# intent.success-shaped sentence, and tabs/newlines.
CASES = [
    "hello world",
    "新しい ユーザー が セットアップ を完了する",
    "新しい　ユーザー　が　セットアップ　を完了する",
    "See [issue-123](https://example.com/123) for details",
    "**bold** and *italic* and `code`",
    "\U0001f389 Done! \U0001f389",
    "**[Rule 1](https://x.com/1)**: ユーザー　が `完了` する \U0001f389",
    "",
    "   　  ",
    "alreadynormalized",
    "[A](url1) and [B](url2)",
    "text [not a link",
    "New user completes setup within 5 minutes.",
    "\t\ttab\tand\nnewline\n",
]


def main() -> int:
    pairs = [{"input": c, "output": normalize_criterion(c)} for c in CASES]
    out_path = (
        Path(__file__).resolve().parent.parent / "fixtures" / "normalize-criterion.golden.json"
    )
    out_path.write_text(json.dumps(pairs, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {out_path} ({len(pairs)} pairs)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
