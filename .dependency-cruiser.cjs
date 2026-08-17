// @ts-check
// Deep-module enforcement for dependency-cruiser.
//
// Each package under packages/ is a DEEP MODULE: a lot of behaviour behind a
// small interface. In this repo a package's PUBLIC SURFACE is the files
// directly in packages/<name>/src/ — its entry points. Implementation lives
// in SUBFOLDERS of src/ (e.g. web/src/components/) and is private; tests live
// in packages/<name>/test/. Compiled entry points in dist/ mirror src/ root
// files and are entry points too (cross-package imports resolve there at
// runtime). A package may expose several small entry points — prefer that
// over one giant barrel index.
//
// The only thing you should ever need to edit here is PACKAGES_ROOT.

/** Where packages live. One immediate child dir per package (flat, no nesting). */
const PACKAGES_ROOT = "packages";

// --- derived patterns (no need to edit) -------------------------------------
const R = PACKAGES_ROOT;
/** A package: group $1 captures the package name. */
const PKG = `^${R}/([^/]+)/`;
/**
 * A package's private internals: anything nested inside a subfolder of src/
 * or dist/. Files directly in src/ (or dist/) are entry points and are NOT
 * matched here — they stay importable from outside.
 */
const PACKAGE_INTERNALS = `^${R}/[^/]+/(src|dist)/[^/]+/`;
/** Tests live in <pkg>/test/ (singular, matching this repo's vitest setup). */
const TESTS = `^${R}/([^/]+)/test/`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "entrypoint-boundary-from-app",
      comment:
        "App/root code may import a package's entry points (files directly in its src/), but nothing inside its subfolders.",
      severity: "error",
      from: { pathNot: `^${R}/` }, // importer is NOT inside any package
      to: { path: PACKAGE_INTERNALS },
    },
    {
      name: "entrypoint-boundary-across-packages",
      comment:
        "A package's own files import each other freely, but may reach OTHER packages only through their entry points — never their internals.",
      severity: "error",
      from: { path: PKG, pathNot: `^${R}/[^/]+/test/` }, // importer is in package $1, not a test
      to: {
        path: PACKAGE_INTERNALS,
        pathNot: `^${R}/$1/`, // same package → intra-package freedom
      },
    },
    {
      name: "tests-through-entrypoints",
      comment:
        "A package's tests exercise it through its entry points like everyone else: they may import any package's entry points and their own test fixtures, but never any package's internals — not even their own.",
      severity: "error",
      from: { path: TESTS }, // a test file, in package $1
      to: {
        path: PACKAGE_INTERNALS,
        pathNot: `^${R}/$1/test/`, // own test fixtures → allowed
      },
    },
    {
      name: "tests-folder-is-private",
      comment:
        "A package's test/ folder is reachable only from tests — nothing else may import fixtures.",
      severity: "error",
      from: { pathNot: `^${R}/[^/]+/test/` }, // importer is not itself a test
      to: { path: `^${R}/[^/]+/test/` },
    },
    {
      name: "no-circular",
      comment: "No dependency cycles. Scope to `^${R}/` if you want to allow cycles outside packages.",
      severity: "error",
      from: {},
      to: { circular: true },
    },

    // --- Layering (optional, off by default) ----------------------------------
    // Interface-hiding controls HOW you import (through the entry points).
    // Layering controls WHICH packages may depend on which. Add your own rules
    // here, e.g.:
    //
    // {
    //   name: "ui-may-not-depend-on-billing",
    //   severity: "error",
    //   from: { path: `^${R}/ui/` },
    //   to:   { path: `^${R}/billing/` },
    // },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  },
};
