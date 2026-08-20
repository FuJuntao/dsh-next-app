# dsh-next-app

A replacement frontend for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) web surface — server-rendered, mobile-first, with built-in authentication. It ships as a published npm bundle and runs from its own dsh profile, leaving the in-box `web` profile untouched.

- Supported dsh version: **0.1.0-rc.7** — each release supports exactly one tested dsh version, and boot fails loudly on a mismatch (ADR-0006, ADR-0008)

## Install

```sh
dsh plugin --profile next-app add @<scope>/dsh-next-app   # from the npm registry
dsh --profile next-app                                    # boot
```

- Side-by-side with `dsh web`: pass `--port` — both profiles default to 3080.
- Update: `dsh plugin --profile next-app update`.
- Rollback: `dsh plugin --profile next-app remove @<scope>/dsh-next-app`.

## Development

```sh
corepack pnpm install
corepack pnpm build
corepack pnpm test
corepack pnpm lint
```

Node and pnpm - exact versions are pinned in `package.json` (`engines`, `packageManager` fields). See [AGENTS.md](./AGENTS.md) for the contributor guide.

## Packages

- [`packages/dsh-api`](packages/dsh-api/README.md) - typed client for the dsh `/api` gateway protocol: exact-pinned, tested against golden wire transcripts, public surface documented.

## Auth

v1 enforces HTTP basic auth (single user) before any request reaches the dsh API:

```sh
DSH_NEXT_APP_USER=<username> \
DSH_NEXT_APP_PASSWORD_HASH=<bcrypt hash> \
dsh --profile next-app
```

Architecture decisions: one ADR file per decision under [`docs/adr/`](docs/adr/README.md).
