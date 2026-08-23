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

v1 enforces HTTP basic auth (single user) in the Next proxy — before any route, including `/api` and static assets, runs. Configure the credential pair on the `next-app-runtime` row in the profile's patch layer (ADR-0008) — `$DSH_HOME/profiles/next-app/cordis.patch.yml` (default `~/.dsh/…`):

```yaml
- id: next-app-runtime
  config:
    auth:
      user: <username>
      passwordHash: <scrypt value>
```

Generate the value with a plain node one-liner — built-ins only, runnable from any directory (ADR-0007):

```sh
node -e "const {scryptSync, randomBytes}=require('node:crypto'); const s=randomBytes(16); const k=scryptSync(process.argv[1], s, 32, {N:16384, r:8, p:1}); console.log('scrypt$16384,8,1$'+s.toString('base64')+'$'+k.toString('base64'))" '<password>'
```

The same override can set the bind `host` and `port` (defaults 127.0.0.1:3080); `--host`/`--port` on the command line override them for one-off runs (ADR-0009). The value is self-describing — `scrypt$<N>,<r>,<p>$<salt>$<key>` — so a deployment can raise the scrypt cost parameters without a code change. The native browser dialog's realm is the optional `auth.realm` (default `dsh-next-app`); a deployment reverse proxy that also runs basic auth can share one dialog per origin with it. The surface fails closed: without the auth config every request is denied and the server logs a loud configuration error, and an incomplete pair (exactly one of user/hash set) refuses to start.

Contributors: see [CONTRIBUTING.md](./CONTRIBUTING.md).