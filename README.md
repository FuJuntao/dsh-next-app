# dsh-next-app

A replacement frontend for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) web surface — server-rendered, mobile-first, with built-in authentication. A pnpm workspace housing the Next.js app and the published bundle that installs into its own dsh profile, leaving the in-box `web` profile untouched.

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

Development instructions - build, pack, and the e2e regression suite - live in
[CONTRIBUTING.md](./CONTRIBUTING.md).

CI gates every PR and push to main: the fast path (`ci` - install, build,
lint) plus a separate `e2e` job that installs the catalog-pinned `dsh` host
from npm and headless Chromium, then runs the regression suite against the
packed bundle (ADR-0006). The suite fails the build on regression - e.g. a
Next catalog bump that changes the child's ready line fails loudly instead of
silently never announcing the URL. Reproduce the `e2e` job locally with
`pnpm --filter e2e exec playwright install chromium` and `pnpm test`
(details in CONTRIBUTING.md).

## Layout

- `apps/web/app/` - the Next.js routes and UI (shell + hydrated chat island)
- `packages/dsh-next-app/` - the published bundle: `cordis.patch.yml`, `dsh.bundle.patch`, the row glue (`src/cli.ts`, `src/runtime.ts` → `lib/` via tsdown)