See [AGENTS.md](./AGENTS.md) for how to contribute: repository map, workflow, conventions, and verification status.

## Development

```sh
corepack pnpm install
corepack pnpm build
corepack pnpm test
corepack pnpm lint
```

Node and pnpm - exact versions are pinned in `package.json` (`engines`,
`packageManager` fields).

### Building and packing the bundle

The published artifact is the tarball of `packages/dsh-next-app` - nothing else runs from the repo tree. The build is dependency-first: `pnpm build` at the root delegates to the bundle, which builds the app first, then the row glue, then stages the app build into the bundle:

1. `next build` - `apps/web`'s production build (Turbopack).
2. `tsdown` - bundles the row glue (`src/cli.ts`, `src/runtime.ts`) to ESM + d.ts in `lib/`; a bundler plugin folds the pack-time staging in: it copies the app build (`.next` without its rebuild cache, `package.json`, `next.config.ts`) into `web/`, the location the runtime row spawns `next start` from.
3. `pnpm pack` (and any future `pnpm publish`) runs `prepack`, which is that same build - every tarball is a fresh, dependency-first build.

The tarball's contents follow the `files` whitelist plus whatever `prepack` staged; pnpm substitutes `catalog:` specifiers into the packed manifest at pack time on the pinned package manager, so build/runtime alignment comes from the build configuration itself - versions are never hand-synced.

The staged `web/` and the emitted `lib/` are gitignored build artifacts.

### Running the e2e regression suite

`pnpm test` drives the end-to-end regression suite (ADR-0006): it packs the
bundle, installs it into a throwaway profile under a scratch `DSH_HOME`, boots
the profile on a free port, and asserts the served page in headless Chromium,
plus the ready-marker pin. Prerequisites: the catalog-pinned `dsh` on `PATH`
and the Chromium browser:

```sh
pnpm --filter e2e exec playwright install chromium
pnpm test
```

The scratch profile lives under the OS temp dir and is removed on teardown; a
missing `dsh` or browser fails the suite loudly.
