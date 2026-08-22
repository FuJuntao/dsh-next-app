# dsh-next-app

A replacement frontend for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) web surface — server-rendered, mobile-first, with built-in authentication. A pnpm workspace of three members: the Next.js app, the published bundle that installs into its own dsh profile, and the e2e regression suite (ADR-0006), leaving the in-box `web` profile untouched.

- Targets dsh **0.1.0-rc.8** — the tested host version; drift protection is regression coverage (ADR-0006) plus install-time peerDependency ranges — no boot-time version check

## Architecture

dsh owns the process: the bundle's server row spawns the built Next app (`next start`) as a managed child with restart-on-crash and tree-scoped teardown. Next is the **only public HTTP surface** — pages, assets, and `/api`. Basic auth sits in Next middleware and covers every route including `/api`. `/api` is served by Next and bridged to the dsh gateway services over a private mode-0600 unix socket carrying the envelope protocol; the browser never sees that protocol. The full record set lives under [`docs/adr/`](docs/adr/README.md).

## Install

```sh
dsh plugin --profile next-app add @<scope>/dsh-next-app   # from the npm registry
dsh --profile next-app                                    # boot
```

- Side-by-side with `dsh web`: pass `--port` — both profiles default to 3080.
- Update: `dsh plugin --profile next-app update`.
- Rollback: `dsh plugin --profile next-app remove @<scope>/dsh-next-app`.

## Auth

v1 enforces HTTP basic auth (single user) in Next middleware, before any route — including `/api` — runs:

```sh
DSH_NEXT_APP_USER=<username> \
DSH_NEXT_APP_PASSWORD_HASH=<bcrypt hash> \
dsh --profile next-app
```

## Development

```sh
corepack pnpm install
corepack pnpm build
corepack pnpm test
corepack pnpm lint
```

Node and pnpm - exact versions are pinned in `package.json` (`engines`, `packageManager` fields). See [AGENTS.md](./AGENTS.md) for the contributor guide.

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

## Layout

- `apps/web/app/` - the Next.js routes and UI (shell + hydrated chat island)
- `packages/dsh-next-app/` - the published bundle: `cordis.patch.yml`, `dsh.bundle.patch`, the row glue (`src/cli.ts`, `src/runtime.ts` → `lib/` via tsdown)