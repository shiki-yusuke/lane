import { resolve } from "node:path";

// Mirrors the Python reference implementation orchestrator.py's resolve_spec_dir: resolved relative to the
// *using* repo's cwd, not the package install location, and overridable so a CLI
// invoked from a script/CI job in a different working directory can still target the
// right repo.
export const SPEC_DIR_ENV_VAR = "LANE_SPEC_DIR";

export function resolveSpecDir(opts: { override?: string; cwd?: string } = {}): string {
  const cwd = opts.cwd ?? process.cwd();
  if (opts.override) return resolve(cwd, opts.override);
  const env = process.env[SPEC_DIR_ENV_VAR];
  if (env) return resolve(cwd, env);
  return resolve(cwd, "docs", "spec");
}
