# ADR-0012: The profile carries the tool-runtime pair — single-instance discipline is bounded to identity-bearing crossings

Status: Accepted

Date: 2026-09-11

Supersedes a clause of ADR-0002 (see "What this changes about ADR-0002").

## Context

ADR-0002 decided that the host packages the bundle's rows name are
peerDependencies resolved from the user's dsh installation. That model assumes
every row in a boot resolves out of one tree. It stops holding the moment the
profile carries a copy of a package the installation also carries, because
cordis resolves a row's package name from the profile's own `node_modules`
first — and some host contracts cross packages through **module-scoped values**,
where two copies are not two allocations but two mutually invisible worlds.

`TOOL_RUNTIME_SCHEDULER` is that case (found as #138). It is `Symbol(...)`, not
`Symbol.for(...)`, declared in `@deepseek-ai/dsh-tools`, and it keys a slot that
crosses a package boundary: the tools row writes
`[TOOL_RUNTIME_SCHEDULER] = { prepare, dispatch, finish, finalize }`, and
`@deepseek-ai/dsh-agent-loop` reads it back through the const it imported
(`ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare(...)`). A `Symbol()`'s identity is
the module instance that created it, and Node's module cache keys on resolved
realpath, so one copy means the write and the read agree and two copies mean
they do not.

The bundle's graph hoisted `dsh-tools` into the profile — through
`dsh-host-apiproxy`, whose client the Next app imports — without hoisting
`dsh-agent-loop`, which the base layer declares and the bundle does not
reference. Registration and lookup therefore met on different Symbols, the
lookup yielded `undefined`, and **every** tool call in an installed boot failed
with `Cannot read properties of undefined (reading 'prepare')`: a message
naming neither package nor cause, from a profile that otherwise boots healthy.

#138 posed three directions: keep rows on peers and stop the profile hoisting
host code; key the slot with a registered symbol upstream; or let the profile
carry the graph it boots rows from. This record picks the third, narrowly.

## Decision

- **The bundle depends on `@deepseek-ai/dsh-tools` and
  `@deepseek-ai/dsh-agent-loop`** — the two halves of the crossing, pinned
  together in the workspace catalog — so one copy of each answers every
  importer in the profile. **Dependencies, not peerDependencies**: the profile
  install runs with `autoInstallPeers` off, so a peer declaration never lands
  in the very tree it is meant to unify.
- **The discipline is bounded to identity-bearing crossings, and the
  discriminator is a key's *registration*.** A duplicate is a correctness
  problem when a value crosses packages by module identity: a module-scoped
  `Symbol()` used as a lookup key, a class used in `instanceof`, a private
  field. A `Symbol.for()` key is not such a problem — the global symbol
  registry hands every copy the same key, so the write and the read agree
  however many instances exist. Duplicates of the second kind are inert: they
  cost bytes, not behaviour.
- **Schemastery is the worked example of the safe case, and the trap in the
  test.** The packed bundle's install holds `@deepseek-ai/schemastery` at **two
  versions in three copies** (ten in a profile where the operator also installs
  host peers by hand), and that is harmless because its cross-package keys are
  `Symbol.for("schemastery")` and `Symbol.for("ValidationError")` — present in
  both the 3.18.1 and the 3.18.2 copy — with its state handoffs on
  `globalThis`. It keys plenty by symbol, and survives duplication *because* the
  symbols are registered. This is the exact change #141 asks of
  `TOOL_RUNTIME_SCHEDULER`. Note the trap: a grep for `Symbol(` finds nothing
  and appears to confirm "no symbol keys at all", because `Symbol.for(` does not
  contain that literal — evidence of that shape proves nothing, and this record
  previously carried such a sentence.
- **The measured extent of the unsafe class, at this host version.** The pinned
  install ships **197** `@deepseek-ai/*` packages. **Five** declare a
  module-scoped `Symbol()` const, and exactly **one** of those is exported and
  read back from another package — `dsh-tools`' `TOOL_RUNTIME_SCHEDULER`, read by
  `dsh-agent-loop`. The other four are confined to the package that declares
  them: `dsh-scope`'s `kScope` is a module-local const, `dsh-client-runtime`'s
  identically named `kScope` is function-local (an identifier collision, not a
  shared key), `dsh-cordis-host-runner`'s `DYNAMIC_TOOL` is written and validated
  inside one package, and `dsh-jobs-local`'s `token` is a per-call local.
  `dsh-tool-cordis` mentions `TOOL_RUNTIME_SCHEDULER` only inside rendered
  API-surface `declaration:` strings, with no runtime access. **Ten** of the 197
  key cross-package state with registered symbols instead, schemastery among
  them. Both counts re-run with:

  ```sh
  cd "$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai"
  grep -rlE --include='*.js' --include='*.cjs' --include='*.mjs' \
    'const [A-Za-z_$][A-Za-z0-9_$]* = Symbol\(' . | sed -E 's|^\./([^/]+)/.*|\1|' | sort -u   # 5
  grep -rlE --include='*.js' --include='*.cjs' --include='*.mjs' 'Symbol\.for\(' . \
    | sed -E 's|^\./([^/]+)/.*|\1|' | sort -u                                                 # 10
  ```

  An earlier draft of this bullet claimed **40** packages used registered
  symbols. That number was produced by a pipeline whose `sed` mapped matches to
  path *prefixes* rather than package names — it counted 40 distinct prefixes, a
  real output of a meaningless unit — which is the same error the bullet above
  warns about, one grep deeper. It is recorded rather than deleted because the
  trap is in the tooling, and a reader who runs the second command should know it
  has already fooled this record once.

  One crossing, therefore, and `IDENTITY_BEARING_CROSSINGS` in
  `e2e/support/profile.ts` is where the next one gets recorded — as a pair, with
  the census failing any duplicate **in the host scope** not on the inert list.

  **That census walks `@deepseek-ai/*`, and the limit is deliberate.** A fresh
  install of the packed bundle holds **351** distinct package names, **12** of
  them multi-copy outside the host scope (`zod`, `semver`, `commander`, `debug`,
  `nanoid`, `@babel/runtime`, `@types/unist`, `client-only`, `loader-utils`,
  `schema-utils`, `web-vitals`, `webpack-sources`). Two of those twelve — `zod`
  (`const BRAND = Symbol("zod_brand")`) and `semver` — do declare module-scoped
  `Symbol()` consts, so the criterion is not exclusive to this scope. What is
  exclusive is the failure mode: **11 of the 12** have a copy under
  `next/dist/compiled/` — Next's own vendored builds, four of them vendor-against-
  vendor — and the twelfth (`@types/unist`) is a nested types-only package with no
  runtime module identity to fork. None of them is a row and its counterpart
  resolving apart, which is the only split this class can fail on; a fork inside a
  vendored build is per-package isolation, which is what bundling is for. Widening
  the walk to every scope would report a dozen known-benign duplicates on every
  install, and a guard that cries wolf on install is a guard that gets skimmed.
  Any statement that the profile must carry "every row package together with the
  rows that talk to it" is **wrong as a general rule** and correct only for the
  pair above.
- **Shipping the whole host graph is rejected on measurement.** Making
  `@deepseek-ai/dsh-base` a dependency — the "one instance wins everywhere"
  reading of this decision — pulls the native tool packages (`node-pty`,
  `koffi`); pnpm 11 refuses their install scripts by default and **exits
  non-zero**, and `dsh plugin add` is a thin pnpm forwarder that propagates
  that exit code and reconciles the layer stack only on success. The bundle
  would become uninstallable through its own documented install path. Measured
  both ways: the base-layer variant exits 1, the narrow pair exits 0 with a
  single `dsh-tools`.
- **Drift protection for these two packages is no longer ADR-0006's peer
  ranges.** As dependencies they left the install-time peerDependency mechanism,
  so three things cover them instead: the exact catalog pins, which move with
  the `@deepseek-ai/dsh` pin; the install-time guard in `e2e/support/profile.ts`,
  which asserts the realpath both halves resolve to is the same and fails on any
  multi-copy `@deepseek-ai` package outside a named inert allow-list; and the
  suite's scripted tool-call spec, which boots the packed tarball and would
  catch a recurrence as a broken tool call rather than a broken boot.

## What this changes about ADR-0002

ADR-0002's Decision states that "the host packages its rows name are
peerDependencies resolved from the dsh installation". For
`@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-agent-loop` that is
superseded: they are dependencies resolved from the profile. The clause stands
unchanged for every other row package — including the ones that turn out to
have no identity-bearing crossing to protect.

## Consequences

- The profile now ships host runtime code it previously borrowed from the
  installation. That is a version-skew surface that did not exist before: an
  install whose pinned pair is older than the host's dsh is now reachable, and
  the catalog pin plus the regression suite are what stand between it and a
  silent break — the installer itself no longer checks.
- Two upstream behaviours are load-bearing here and are named as dependencies,
  not facts: **cordis resolves a row's package name from the profile's tree
  before the installation's**, and **the scheduler slot stays keyed by a
  module-scoped `Symbol()`**. If the first ever changes, the profile copy stops
  winning and the fix silently stops mattering; the second is #141, and what it
  would retire is recorded below.
- The guard's inert allow-list is a claim about the current host graph, not a
  law. A host package that starts forking a cross-package key — a module-scoped
  `Symbol()`, an `instanceof` class, a private field — must join
  `IDENTITY_BEARING_CROSSINGS` **as a pair**, naming both the package that owns
  the key and the one that reads through it; adding it to the allow-list
  asserts the opposite. Until then the census fails a new duplicate at install
  time rather than waiting for a tool call to break.
- If #141 lands, `dsh-tools` moves into the inert class by the criterion above —
  its key becomes registered, so copies agree — the crossing entry and the two
  dependencies can go back to peers, and this record retires. That is the
  expected end state, not a hypothetical: schemastery shows what a
  well-behaved package looks like under duplication.
