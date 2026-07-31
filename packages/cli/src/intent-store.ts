import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Intent, IntentSchema } from "@lane/schemas";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export function intentPath(specDir: string, intentId: string): string {
  return join(specDir, intentId, "intent.yaml");
}

/**
 * Every intent id with an intent.yaml directly under specDir (`lane next`, M3 — needs to
 * enumerate all lanes to build a candidate list, not just one). Returns [] if specDir
 * doesn't exist yet rather than throwing (a brand-new repo with no lanes started is not an
 * error).
 */
export function listIntentIds(specDir: string): string[] {
  if (!existsSync(specDir)) return [];
  return readdirSync(specDir)
    .filter((name) => {
      const dirPath = join(specDir, name);
      return statSync(dirPath).isDirectory() && intentExists(specDir, name);
    })
    .sort();
}

export function intentExists(specDir: string, intentId: string): boolean {
  return existsSync(intentPath(specDir, intentId));
}

export function readIntent(specDir: string, intentId: string): Intent {
  const raw = parseYaml(readFileSync(intentPath(specDir, intentId), "utf-8"));
  return IntentSchema.parse(raw);
}

export function writeIntent(specDir: string, intentId: string, intent: Intent): void {
  const validated = IntentSchema.parse(intent);
  const path = intentPath(specDir, intentId);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, stringifyYaml(validated));
}
