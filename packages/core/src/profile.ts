import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Profile, ProfileSchema } from "@lane/schemas";
import { parse as parseYaml } from "yaml";

// design.md §3.7 — same resolution order as the Python reference implementation (flag > env > repo_local >
// package default), with the repo-local directory renamed from `.lane/profiles/` to
// `profiles-local/` (design.md §7.2: committable profile vs. gitignored runtime data must
// not share a directory).

export const PROFILE_PATH_ENV_VAR = "LANE_PROFILE_PATH";
const REPO_LOCAL_DIR = "profiles-local";

export type ProfilePathSource = "flag" | "env" | "repo_local" | "package_default";

export interface ResolveProfilePathOptions {
  explicit?: string;
  profileId?: string;
  cwd?: string;
  /**
   * Path to the profile a package ships as its own default. Not resolved by this
   * function itself: the *caller* (e.g. @lane/cli) knows where its own bundled resources
   * live once packaged (`pnpm pack`), so it passes that path in rather than core reaching
   * outside its own package boundary to find it.
   */
  packageDefaultPath: string;
}

export interface ResolvedProfilePath {
  path: string;
  source: ProfilePathSource;
}

function lookupRepoLocal(id: string, cwd: string): string | null {
  const candidates = [`${id}.profile.yaml`, `project-profile.${id}.yaml`];
  for (const fname of candidates) {
    const p = join(cwd, REPO_LOCAL_DIR, fname);
    if (existsSync(p)) return p;
  }
  return null;
}

export function resolveProfilePath(opts: ResolveProfilePathOptions): ResolvedProfilePath {
  const cwd = opts.cwd ?? process.cwd();

  if (opts.explicit) {
    if (existsSync(opts.explicit)) {
      return { path: opts.explicit, source: "flag" };
    }
    // Not a file path: treat it as a profile id and resolve it under profiles-local/
    // *right here*, before ever consulting env. An explicit --profile always outranks
    // LANE_PROFILE_PATH (design.md §3.7: "flag > env > repo_local > package default") —
    // whether the flag resolves via a direct path or via a repo-local id lookup, it is
    // still the flag tier, not the repo_local tier (Codex M1 review, should-4: this used
    // to fall through to the env check first, letting env silently win over an explicit
    // --profile id).
    const viaExplicitId = lookupRepoLocal(opts.explicit, cwd);
    if (viaExplicitId) {
      return { path: viaExplicitId, source: "flag" };
    }
  }

  const envVal = process.env[PROFILE_PATH_ENV_VAR];
  if (envVal) {
    if (!existsSync(envVal)) {
      throw new Error(`${PROFILE_PATH_ENV_VAR} points to a non-existent file: ${envVal}`);
    }
    return { path: envVal, source: "env" };
  }

  if (opts.profileId) {
    const viaProfileId = lookupRepoLocal(opts.profileId, cwd);
    if (viaProfileId) return { path: viaProfileId, source: "repo_local" };
  }

  return { path: opts.packageDefaultPath, source: "package_default" };
}

export function loadProfile(path: string): Profile {
  const raw = parseYaml(readFileSync(path, "utf-8"));
  return ProfileSchema.parse(raw);
}
