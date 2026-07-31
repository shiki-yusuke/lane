import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Critic, Profile } from "@lane/schemas";
import { buildCriticSchema } from "@lane/schemas";
import { parse as parseYaml } from "yaml";

export function criticPath(specDir: string, intentId: string): string {
  return join(specDir, intentId, "critic.yaml");
}

/**
 * `undefined` when critic.yaml doesn't exist yet (Phase 1, before it's written — never
 * required, matching intent.yaml/verification.yaml's own "read-if-exists" convention).
 * Throws (schema error) if it exists but doesn't match `buildCriticSchema(profile)` — the
 * schema is profile-dependent (design.md §2.3: core 9 lenses + up to 3 of the profile's
 * own extra_lenses), so the caller must have already resolved a profile before calling
 * this (Codex M4 review, must-2: previously nothing validated critic.yaml's own shape at
 * all, so a malformed lens list or a missing finding/taxonomy on an `applicable` result
 * could sail through every gate undetected).
 */
export function readCriticIfExists(
  specDir: string,
  intentId: string,
  profile: Profile,
): Critic | undefined {
  const path = criticPath(specDir, intentId);
  if (!existsSync(path)) return undefined;
  const raw = parseYaml(readFileSync(path, "utf-8"));
  return buildCriticSchema(profile).parse(raw);
}
