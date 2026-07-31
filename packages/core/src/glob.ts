// Minimal glob matcher for profile path patterns (forbidden_paths_for_low_risk,
// risk_auto_upgrade.when.paths, allowed_paths/forbidden_paths). Supports `**` (any number
// of path segments, including zero), `*` (anything within one segment), and `?` (single
// character). Deliberately small rather than pulling in a glob dependency for M1.
function globToRegExp(pattern: string): RegExp {
  let out = "^";
  const chars = Array.from(pattern);
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === undefined) continue;
    if (c === "*" && chars[i + 1] === "*") {
      out += ".*";
      i++;
      // consume an immediately following "/" so "**/x" also matches "x" at depth 0.
      if (chars[i + 1] === "/") i++;
    } else if (c === "*") {
      out += "[^/]*";
    } else if (c === "?") {
      out += "[^/]";
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  out += "$";
  return new RegExp(out);
}

export function matchesGlob(pattern: string, path: string): boolean {
  return globToRegExp(pattern).test(path);
}

/**
 * design.md §5.4 — path-prefix match on segment boundaries: "src/foo" must not match
 * "src/foobar". A plain `startsWith` would allow that false positive.
 */
export function matchesPathPrefixSegments(prefix: string, path: string): boolean {
  if (prefix === "") return true;
  const prefixSegs = prefix.split("/").filter((s) => s.length > 0);
  const pathSegs = path.split("/").filter((s) => s.length > 0);
  if (prefixSegs.length > pathSegs.length) return false;
  return prefixSegs.every((seg, i) => seg === pathSegs[i]);
}
