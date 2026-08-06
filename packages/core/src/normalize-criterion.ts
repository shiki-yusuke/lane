// Gate-port review (2026-08-06) — ported unchanged from the reference implementation's
// validate.py normalize_criterion (v0.9.0). Used by successCriteriaGate (gate.ts) to
// compare intent.intent.success lines against success_criteria_matrix[].criterion after
// normalized full-text-equality (never fuzzy similarity -- see gate.ts's doc comment).
//
// Deliberately absorbs only three things (no more): a markdown link's display text, the
// emphasis/code-span punctuation marks, and all whitespace (ASCII and full-width U+3000).
// It does NOT lowercase, NFKC-normalize, strip punctuation generally, reorder words, or
// otherwise paraphrase -- a criterion that summarizes rather than transcribes
// intent.success verbatim is meant to still fail this comparison.
export function normalizeCriterion(text: string): string {
  let t = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // markdown link [display](url) -> display
  t = t.replaceAll("**", "").replaceAll("*", "").replaceAll("`", "");
  // JS's \s already matches U+3000 (IDEOGRAPHIC SPACE) per the ECMAScript spec's own
  // WhiteSpace production, so 　 here is redundant with \s -- kept explicit anyway to
  // mirror the reference implementation's own explicit inclusion and avoid relying on a
  // reader already knowing that.
  t = t.replace(/[\s　]+/g, "");
  return t;
}
