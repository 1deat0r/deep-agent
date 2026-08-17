# Packages are deep modules

Every package under `packages/` is a **deep module**: a lot of behaviour behind
a small interface. Copy `packages/example/` to start a new one — it has the
shape right and its test passes.

## Layout

```
packages/
  example/
    src/
      index.ts      ← an entry point (public). Import this from outside.
      client.ts     ← another entry point. Packages may expose SEVERAL.
      lib/          ← implementation: hidden from outside, free to import each other.
    test/           ← co-located tests + fixtures (private to tests).
```

A package's public surface is the files directly in its `src/` (compiled to
`dist/` at the same depth). Anything in a subfolder of `src/` is private —
conventionally `lib/` for implementation; any subfolder is private, so a new
folder never needs a config change.

**Import only through a package's entry points.** Inside your own package,
import freely. From any other package — or a test — import a package's
root-level `src/` files and nothing deeper. Tests exercise a package through
its entry points exactly like everyone else.

**No barrels.** Expose several small entry points (`index.ts`, `client.ts`,
`server.ts`) instead of one giant `index.ts` re-exporting a whole subtree.

## The four rules (enforced)

1. **Entry-point boundary** — code outside a package may import its entry
   points only, never its subfolder internals.
2. **Intra-package freedom** — a package's own files import each other freely.
3. **Tests through the entry points** — `test/` files may import any package's
   entry points and their own `test/` fixtures, but never any package's
   internals — not even their own package's.
4. **No cycles** — no dependency cycles anywhere in `packages/`.

Run `pnpm lint:boundaries` (dependency-cruiser) — it also runs in `pnpm check`.
Layering (which packages may depend on which) is left as a commented stub in
`.dependency-cruiser.cjs`.
