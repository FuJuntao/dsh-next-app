# ADR-0008: Basic-auth configuration via cordis row config

Status: Accepted

Date: 2026-08-23

## Context

ADR-0001 decided the fence's credential provisioning channel: "credentials
provisioned in the environment", and ADR-0007 kept that channel (its value
format is a self-describing scrypt string). In practice the deployer's
configuration surface for a dsh profile is its patch layer: the profile's
`cordis.patch.yml` (user patch, applied after every bundle layer) carries
id-targeted row overrides, and a row's `config` block is delivered to the
plugin's `apply(ctx, config)` by the cordis loader. Environment variables
are invisible in that surface: a deployment that manages profiles through
their patch files cannot see or audit the auth config.

## Decision

- **Supersede the provisioning-channel clauses of ADR-0001 and ADR-0007**:
  the basic-auth config (user, scrypt value, realm) is **cordis row config
  on the `next-app-runtime` row**, written by the deployer as an
  id-targeted override in the profile's user patch layer
  (`~/.dsh/profiles/next-app/cordis.patch.yml`):

  ```yaml
  - id: next-app-runtime
    config:
      auth:
        user: <username>
        passwordHash: <scrypt value>
        realm: <realm>          # optional; default dsh-next-app
  ```

- The bundle's own patch declares no config (the values are per-deployment);
  a missing or partial `auth` block is legitimate and means the fence
  fails closed, exactly like an unprovisioned credential pair before.
- **Validation moves to the runtime row's mount**: an incomplete pair
  (exactly one of user/passwordHash set) throws from `apply`, so the
  profile refuses to boot with a loud error instead of serving half-gated.
- The **scrypt value format is unchanged** (ADR-0007); only its channel
  changes. The runtime still forwards the values into the spawned `next
  start` child through the subprocess spec's explicit env layer, because
  the host service scrubs `DSH_*` and credential-shaped names from
  implicit inheritance.
- `next-app-cli` reverts to being purely the flag parser (`--host`,
  `--port`); the `nextAppCli` service no longer carries auth.
- Rejected: row config on the `next-app-cli` row (keeps a provider hop for
  values the CLI never uses); keeping the environment as the channel
  (invisible to patch-managed deployments).

## Consequences

- The auth config is declarative, auditable, and managed through the same
  patch surface as every other profile setting; `dsh --dump-config`
  prints the merged row config.
- The credential value lives in the profile's patch file (user-owned,
  private under `DSH_HOME`) rather than the process environment — the
  same file-based model the harness itself uses for secrets (settings
  layers), so the threat surface is unchanged in practice.
- The README contract changes from `DSH_NEXT_APP_USER=… dsh --profile
  next-app` to editing the profile's patch; the scrypt generation one-liner
  is unchanged.
- A malformed pair now fails at row mount (tree boot) rather than at argv
  parse — still a loud refusal to start, asserted by the e2e suite.
