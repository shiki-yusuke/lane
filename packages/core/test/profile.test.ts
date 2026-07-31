import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROFILE_PATH_ENV_VAR, loadProfile, resolveProfilePath } from "../src/profile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// test/ -> core/ -> packages/ -> repo root -> profiles/generic.profile.yaml
const packageDefaultPath = join(__dirname, "..", "..", "..", "profiles", "generic.profile.yaml");

describe("resolveProfilePath resolution order", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "lane-profile-test-"));
    delete process.env[PROFILE_PATH_ENV_VAR];
  });

  afterEach(() => {
    delete process.env[PROFILE_PATH_ENV_VAR];
  });

  it("falls back to package default when nothing else is given", () => {
    const result = resolveProfilePath({ cwd, packageDefaultPath });
    expect(result).toEqual({ path: packageDefaultPath, source: "package_default" });
  });

  it("prefers an explicit flag path over everything else", () => {
    const explicitPath = join(cwd, "explicit.yaml");
    writeFileSync(explicitPath, "schema_version: '1.0'\nprofile_id: explicit\n");
    process.env[PROFILE_PATH_ENV_VAR] = "/should/not/be/used.yaml"; // would throw if consulted
    const result = resolveProfilePath({ explicit: explicitPath, cwd, packageDefaultPath });
    expect(result).toEqual({ path: explicitPath, source: "flag" });
  });

  it("prefers env over repo_local and package default", () => {
    const envPath = join(cwd, "env.yaml");
    writeFileSync(envPath, "schema_version: '1.0'\nprofile_id: env\n");
    process.env[PROFILE_PATH_ENV_VAR] = envPath;
    mkdirSync(join(cwd, "profiles-local"), { recursive: true });
    writeFileSync(
      join(cwd, "profiles-local", "myid.profile.yaml"),
      "schema_version: '1.0'\nprofile_id: myid\n",
    );
    const result = resolveProfilePath({ profileId: "myid", cwd, packageDefaultPath });
    expect(result).toEqual({ path: envPath, source: "env" });
  });

  it("resolves a profile id against profiles-local/ when no flag/env is given", () => {
    mkdirSync(join(cwd, "profiles-local"), { recursive: true });
    const localPath = join(cwd, "profiles-local", "myid.profile.yaml");
    writeFileSync(localPath, "schema_version: '1.0'\nprofile_id: myid\n");
    const result = resolveProfilePath({ profileId: "myid", cwd, packageDefaultPath });
    expect(result).toEqual({ path: localPath, source: "repo_local" });
  });

  it("an explicit --profile id still outranks LANE_PROFILE_PATH env (Codex M1 review, should-4)", () => {
    // Regression: resolveProfilePath used to fall through to the env check before trying
    // to resolve opts.explicit as a profile id, so an explicit `--profile myid` would
    // silently lose to LANE_PROFILE_PATH even though design.md §3.7 states flag > env
    // unconditionally.
    mkdirSync(join(cwd, "profiles-local"), { recursive: true });
    const explicitIdPath = join(cwd, "profiles-local", "myid.profile.yaml");
    writeFileSync(explicitIdPath, "schema_version: '1.0'\nprofile_id: myid\n");
    const envPath = join(cwd, "env.yaml");
    writeFileSync(envPath, "schema_version: '1.0'\nprofile_id: env\n");
    process.env[PROFILE_PATH_ENV_VAR] = envPath;

    const result = resolveProfilePath({ explicit: "myid", cwd, packageDefaultPath });
    expect(result).toEqual({ path: explicitIdPath, source: "flag" });
  });
});

describe("loadProfile", () => {
  it("parses and validates the package-bundled generic profile", () => {
    const profile = loadProfile(packageDefaultPath);
    expect(profile.profile_id).toBe("generic");
    expect(profile.distance_caps.files_touched_estimate).toBeGreaterThan(0);
  });
});
