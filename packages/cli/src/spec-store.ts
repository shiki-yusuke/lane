import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function specMdPath(specDir: string, intentId: string): string {
  return join(specDir, intentId, "spec.md");
}

/** Raw spec.md content, or null if it doesn't exist yet (e.g. lane is still at 1_intent/2_spec). */
export function readSpecMdIfExists(specDir: string, intentId: string): string | null {
  const path = specMdPath(specDir, intentId);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

export function writeSpecMd(specDir: string, intentId: string, content: string): void {
  const path = specMdPath(specDir, intentId);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}
