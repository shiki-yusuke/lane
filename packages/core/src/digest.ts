import { createHash } from "node:crypto";

// Shared by risk.ts (profile_digest, §3.4 audit log) and application/consensus-service.ts
// (spec_digest/verification_digest, §2.4/§3.3) so both go through one sha256 helper rather
// than each rolling its own.
export function computeDigest(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}
