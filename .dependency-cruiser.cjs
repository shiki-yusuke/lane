/**
 * Enforces the dependency direction fixed in docs/design.md §2.1 / §6:
 *   schemas -> (nothing in this monorepo)
 *   core    -> schemas
 *   adapters -> core, schemas
 *   cli     -> core, adapters, schemas
 * and forbids any package-level cycle (design.md §9 checkpoint 4).
 */
module.exports = {
  forbidden: [
    {
      name: "no-package-cycles",
      severity: "error",
      comment: "No cycles are allowed between packages/* (or within a package's own modules).",
      from: {},
      to: { circular: true },
    },
    {
      name: "schemas-no-deps-on-siblings",
      severity: "error",
      comment: "packages/schemas must not depend on core/adapters/cli (schemas is the bottom layer).",
      from: { path: "^packages/schemas/src" },
      to: { path: "^packages/(core|adapters|cli)/src" },
    },
    {
      name: "core-only-depends-on-schemas",
      severity: "error",
      comment: "packages/core must not depend on adapters/cli.",
      from: { path: "^packages/core/src" },
      to: { path: "^packages/(adapters|cli)/src" },
    },
    {
      name: "adapters-no-deps-on-cli",
      severity: "error",
      comment: "packages/adapters must not depend on cli.",
      from: { path: "^packages/adapters/src" },
      to: { path: "^packages/cli/src" },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
