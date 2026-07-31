import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Path to @lane/cli's own bundled default profile (resources/profiles/generic.profile.yaml,
 * included via package.json "files" so it survives `pnpm pack`). core/profile.ts's
 * resolveProfilePath() takes this as an explicit parameter rather than looking it up
 * itself, since "where does *this* package's bundled default live" is inherently a
 * CLI-package concern, not core's (see core/profile.ts's ResolveProfilePathOptions doc).
 */
export function packageDefaultProfilePath(): string {
  // dist/default-profile.js -> dist -> cli package root -> resources/profiles/...
  return join(__dirname, "..", "resources", "profiles", "generic.profile.yaml");
}
