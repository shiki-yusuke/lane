#!/usr/bin/env node
// Builds the publishable `spec-lane` npm package (see publish/spec-lane/package.json) from
// this monorepo's workspace source. This is *not* run by `pnpm -r run build` -- that command
// only produces each @lane/* workspace package's own dist/ for internal use (tests,
// dependency-cruiser, `npm link`-based local dev). This script instead bundles
// packages/cli's compiled entrypoint plus everything it pulls in from @lane/schemas,
// @lane/core, and @lane/adapters into a single self-contained file, so the published
// package has zero `workspace:*` dependencies at runtime -- only the same three real npm
// packages (commander, yaml, zod) that packages/cli/package.json already depends on, kept
// external rather than bundled since they're plain CJS/ESM npm packages with no reason to
// duplicate inside the bundle.
//
// Usage: node scripts/build-publish.mjs
// Prerequisite: `pnpm -r run build` (this script does not rebuild the workspace packages
// itself, since it's meant to run right after the same clean-verification build already
// used for tests).

import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const cliDistEntry = join(rootDir, "packages", "cli", "dist", "main.js");
const publishDir = join(rootDir, "publish", "spec-lane");
const outDir = join(publishDir, "dist");
const outFile = join(outDir, "main.js");

if (!existsSync(cliDistEntry)) {
  console.error(
    `Missing ${cliDistEntry} -- run "pnpm -r run build" first (this script bundles the ` +
      "already-compiled workspace output, it doesn't run tsc itself).",
  );
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// format=esm is required here, not a style choice: our own source uses `import.meta.url`
// (see packages/cli/src/default-profile.ts) to locate bundled resources at runtime, and
// esbuild only preserves import.meta semantics correctly for esm output -- format=cjs
// silently turns import.meta.url into undefined instead. The three npm packages are kept
// external (see file header) specifically because esbuild's esm output has no static way to
// convert an external package's *internal* `require("node:...")` calls into imports -- only
// cjs output supports that -- so bundling commander in particular would fail at runtime with
// "Dynamic require of ... is not supported" (confirmed by hand before settling on this
// flag set; keep node:* external too, for the same reason, on the off chance a future
// @lane/* module reaches for a node builtin some other bundled dependency also requires).
execFileSync(
  join(rootDir, "node_modules", ".bin", "esbuild"),
  [
    cliDistEntry,
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node22",
    `--outfile=${outFile}`,
    "--external:node:*",
    "--external:commander",
    "--external:yaml",
    "--external:zod",
  ],
  { stdio: "inherit" },
);
chmodSync(outFile, 0o755);

const resourcesDest = join(publishDir, "resources");
rmSync(resourcesDest, { recursive: true, force: true });
cpSync(join(rootDir, "packages", "cli", "resources"), resourcesDest, { recursive: true });

cpSync(join(rootDir, "README.md"), join(publishDir, "README.md"));
cpSync(join(rootDir, "LICENSE"), join(publishDir, "LICENSE"));

console.log(`Built ${outFile}`);
