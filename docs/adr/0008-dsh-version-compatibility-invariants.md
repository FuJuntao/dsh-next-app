# ADR-0008: dsh version compatibility and invariants

Status: Accepted

Date: 2026-08-16

## Context

In-box bundles ship inside the dsh installation, so base and surface
versions match by construction. A published npm bundle breaks that
lockstep: `dsh-base` resolves from the user's installation while the
bundle's own dependencies install into the profile's `node_modules`, so
one Cordis tree could mount two versions of the same host package and
drift silently — the exact quiet-corruption failure ADR-0006 guards
against.

## Decision

- The bundle declares the in-box host packages its rows name as
  **peerDependencies** — nothing installs into the profile's
  `node_modules`; plugin rows and bundle code resolve them from
  `$DSH_HOME/profiles/node_modules`, the symlinked dependency closure of
  the user's dsh installation, so host packages always come from the
  same version as the running `dsh-base`. The cross-cutting service
  contracts (`cordis`, `cordis-plugin-loader`, `dsh-invariants`,
  `dsh-shell-env`, `dsh-system-prompt`) are peerDependencies too,
  mirroring the in-box manifest.
- The bundle ships an `./invariant` companion (the in-box
  `dsh-invariants` mechanism): it registers with the `invariants`
  service and fails the boot loudly when the running dsh version does
  not exactly match the version the bundle was tested against.
- Releases are **per dsh bump**: each release supports exactly one
  tested dsh version, stated in the README; publishing is coupled to
  the ADR-0006 upgrade drill (bump → contract tests → schema diff → pin
  update → publish).

## Consequences

- Version drift becomes impossible by construction: host packages come
  from the installation, and the strict-equality invariant turns any
  mismatch into a boot error instead of corrupted rendering.
- Profile installs carry only the bundle's own dependencies — a smaller
  install surface, at the price of a hard coupling between our release
  cadence and upstream's.
- The invariant and the manifest pins become part of the upgrade drill
  — extra upkeep per release, bought once per dsh bump.
