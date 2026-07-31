import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Verification, VerificationSchema } from "@lane/schemas";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export function verificationPath(specDir: string, intentId: string): string {
  return join(specDir, intentId, "verification.yaml");
}

export function readVerificationIfExists(specDir: string, intentId: string): Verification | null {
  const path = verificationPath(specDir, intentId);
  if (!existsSync(path)) return null;
  const raw = parseYaml(readFileSync(path, "utf-8"));
  return VerificationSchema.parse(raw);
}

export function writeVerification(
  specDir: string,
  intentId: string,
  verification: Verification,
): void {
  const validated = VerificationSchema.parse(verification);
  const path = verificationPath(specDir, intentId);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, stringifyYaml(validated));
}
