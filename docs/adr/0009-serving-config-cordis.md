# ADR-0009: Serving parameters (host, port) as cordis row config

Status: Accepted

Date: 2026-08-23

## Context

ADR-0008 moved the basic-auth config onto the `next-app-runtime` row as
cordis row config, so a deployment's persistent settings live in the
profile's patch layer. The bind host and listen port still come only from
the `--host`/`--port` command-line flags (with hardcoded defaults in the
runtime), which is inconsistent: two of the row's serving parameters are
invocation-only, the rest are declarative.

## Decision

- **The bind host and listen port are cordis row config on the
  `next-app-runtime` row** (extending ADR-0008's channel to the serving
  parameters):

  ```yaml
  - id: next-app-runtime
    config:
      host: 0.0.0.0
      port: 8080
      auth:
        user: <username>
        passwordHash: <scrypt value>
  ```

- **Precedence: `--host`/`--port` flags > row config > defaults**
  (127.0.0.1, 3080). The flags remain as explicit invocation-time overrides
  — the documented side-by-side flow (`dsh --profile next-app --port 3081`
  next to `dsh web`) and the e2e suite's per-instance ports (three
  instances of one installed profile on different ports, concurrently)
  depend on them; removing the flags would force per-instance profile
  clones in the suite.
- A configured `port` that is not a positive integer is a
  misconfiguration: the row refuses to boot with a loud error at mount,
  exactly like an incomplete auth pair (ADR-0008). An empty `host` is
  treated as unset.
- Rejected: removing the flags entirely (breaks side-by-side runs and the
  suite's multi-instance model); flags as the only source (the
  inconsistency this record removes).

## Consequences

- Deployments configure host/port declaratively in the same patch override
  as auth; one-off and test invocations keep the flags.
- The runtime row merges `flag ?? config ?? default` in one place, so the
  precedence is auditable and asserted by the e2e suite.
- No change to the CLI row's parsing; its help text documents the override
  relationship.
