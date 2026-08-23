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
2. `tsdown` - bundles the row glue (`src/cli.ts`, `src/runtime.ts`) to ESM + d.ts in `lib/`; a bundler plugin folds the pack-time staging in: it copies the app build (`.next` without its rebuild cache, `package.json`, `next.config.ts`) into `web/`, the location the runtime row spawns `next start` from. App dependencies resolve at profile runtime from the bundle's own manifest (the profile install provides them), so the tarball carries no node_modules.
3. `pnpm pack` (and any future `pnpm publish`) runs `prepack`, which is that same build - every tarball is a fresh, dependency-first build.

The tarball's contents follow the `files` whitelist plus whatever `prepack` staged; pnpm substitutes `catalog:` specifiers into the packed manifest at pack time on the pinned package manager, so build/runtime alignment comes from the build configuration itself - versions are never hand-synced.

The staged `web/` and the emitted `lib/` are gitignored build artifacts.

### Running the e2e regression suite

`pnpm test` drives the end-to-end regression suite (ADR-0006): it packs the
bundle, installs it into a throwaway profile under a scratch `DSH_HOME`, boots
the profile on a free port, and asserts the served page in headless Chromium
behind the basic-auth fence (the suite writes a credential pair into the
profile's patch layer — ADR-0008 — and asserts 401s without it, including
the fail-closed behavior), plus the ready-marker pin and the supervision
behavior: a crashed Next child is restarted with backoff, and stopping the
profile terminates the child's process tree with the port released.
Prerequisites: the catalog-pinned `dsh`
on `PATH` and the Chromium browser:

```sh
pnpm --filter e2e exec playwright install chromium
pnpm test
```

The scratch profile lives under the OS temp dir and is removed on teardown; a
missing `dsh` or browser fails the suite loudly.

### CI

The suite runs as a separate `e2e` job in CI (`.github/workflows/ci.yml`),
parallel to the fast `ci` job (install, build, lint): dsh boot is slow, so
the suite stays off the fast path (ADR-0006). The job installs the
catalog-pinned `dsh` host from npm - the version is read from
`pnpm-workspace.yaml`, never hand-synced - and the Chromium browser with
system dependencies (`playwright install --with-deps chromium`), then runs
`pnpm test`, which packs the bundle itself: nothing runs from the repo tree.
The job gates every PR and push to main, so a regression - e.g. a Next catalog
bump that changes the child's ready line - fails the build.
