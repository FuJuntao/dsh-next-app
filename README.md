# dsh-next-app

A replacement frontend for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) web surface — server-rendered, mobile-first, with built-in authentication. A pnpm workspace of two members: the Next.js app and the published bundle that installs into its own dsh profile, leaving the in-box `web` profile untouched (ADR-0001, ADR-0002).

- Targets dsh **0.1.0-rc.7** — the version pin, boot invariant, and contract tests land with the bridge story

## Architecture

dsh owns the process: the bundle's server row spawns the built Next app (`next start`) as a managed child with restart-on-crash and tree-scoped teardown. Next is the **only public HTTP surface** — pages, assets, and `/api`. Basic auth sits in Next middleware and covers every route including `/api`. `/api` is served by Next and bridged to the dsh gateway services over a private mode-0600 unix socket carrying the envelope protocol; the browser never sees that protocol (ADR-0001, ADR-0003). The full record set lives under [`docs/adr/`](docs/adr/README.md).

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

## Layout

- `apps/web/app/` - the Next.js routes and UI (shell + hydrated chat island, ADR-0001)
- `packages/dsh-next-app/` - the published bundle: `cordis.patch.yml`, `dsh.bundle.patch`, the row glue (`src/web-startup.ts` → `lib/`)
