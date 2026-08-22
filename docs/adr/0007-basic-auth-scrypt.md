# ADR-0007: Basic-auth password verification — built-in scrypt, no dependencies

Status: Accepted

Date: 2026-08-23

## Context

ADR-0001 decided the fence's credential verification: "credentials provisioned
in the environment as a bcrypt hash; constant-time comparison". The natural
implementation is the native `bcrypt` npm addon, which carries an install
script (node-gyp-build) that downloads or compiles a platform-specific binary.

The repo pins pnpm 11.22, whose build-approval policy refuses to run
dependency install scripts unless explicitly allowed. The dsh profile
directory — where `dsh plugin --profile <name> add` installs this bundle — is
initialized by the dsh host with its own `pnpm-workspace.yaml`, which neither
this bundle nor the deploying user can amend from the documented flow. The
result: installing the bundle fails under pnpm 11 regardless of whether the
native binary was actually needed (bcrypt ships prebuilt binaries for common
platforms, so its install script is a no-op there — the policy alone is the
obstacle). Pure-JS `bcryptjs` avoids the script but still adds a dependency
for an operation Node can already do.

Node's built-in `crypto` module provides `scrypt` — a memory-hard password
KDF in the same family as bcrypt (stronger against GPU/ASIC brute force, no
72-byte password truncation) — and `timingSafeEqual` for an explicit
constant-time comparison. The host runs Node >= 24 (the repo's engines
floor), so both are always present.

## Decision

- **Supersede ADR-0001's "bcrypt hash" clause**: password verification uses
  Node's built-in `crypto` scrypt — no bcrypt dependency, no install
  scripts, no bundler externalization. Everything else in ADR-0001's fence
  decision is unchanged.
- **Environment value format** for `DSH_NEXT_APP_PASSWORD_HASH` — a
  self-describing, parameter-encoded string:

  ```
  scrypt$<N>,<r>,<p>$<salt-base64>$<key-base64>
  ```

  N/r/p are the scrypt cost parameters (N a power of two, default
  16384,8,1); salt is 16 bytes; key is 32 bytes. The value carries its own
  parameters, so deployments can raise the cost without a code change.
- **Constant-time comparison** via `crypto.timingSafeEqual` on the derived
  key (ADR-0001's constant-time requirement, made explicit). A malformed or
  unparseable value fails closed exactly like a missing one: 401 everywhere
  plus a loud error log.
- The env var names are unchanged (`DSH_NEXT_APP_USER`,
  `DSH_NEXT_APP_PASSWORD_HASH`, `DSH_NEXT_APP_REALM`); only the value
  format of the hash changes.
- Rejected: native `bcrypt` (pnpm 11 build-approval policy fails the dsh
  profile install; per-platform binaries/toolchain needed for less common
  platforms); `bcryptjs` (works, but adds a dependency where Node's built-in
  scrypt is strictly stronger for the same effort).

## Consequences

- The auth path has zero third-party dependencies: nothing to install, no
  build scripts, no approval configuration, no bundler externalization —
  installs work under any pnpm version.
- `DSH_NEXT_APP_PASSWORD_HASH` values are no longer bcrypt hashes; the
  README documents the generation one-liner (plain `node -e` with built-ins,
  runnable from any directory). Older bcrypt values are not accepted.
- Each verification runs a memory-hard KDF (~16 MB at the default
  parameters) on the request path; for a single-user basic-auth fence this
  is the same cost class as the bcrypt compare ADR-0001 accepted.
- ADR-0001 stays frozen; this record supersedes only its credential-format
  clause. The fence's remaining decisions (single user, native dialog,
  configurable realm, one fence over the whole surface) stand.
