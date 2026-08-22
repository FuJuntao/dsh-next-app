# ADR-0001: The repo's purpose — a Next.js web surface for dsh with a public API guarded by auth

Status: Accepted

Date: 2026-08-16 (updated 2026-08-21)

## Context

dsh is a Cordis-based harness: its host composition provides the
services that matter (sessions, agents, tools, the model route), and
web surfaces are profiles layered over it. The in-box surface is a
client-rendered SPA (Vite build, static `index.html`, 4.6 MB bundle)
with no auth layer and weak mobile support. This repo replaces that
surface.

## Decision

- Build the replacement in **Next.js with the App Router and React
  Server Components**: Server Components render the shell on first
  paint (session list, settings, static content); live surfaces
  hydrate a small client bundle; the chat stream is a **hydrated chat
  island**; mobile-first layout from day one. Component-level
  customization is deliberately out of scope for v1.
- The app runs as a **managed child of dsh**: the bundle's server row
  spawns `next start` through the `subprocess` service when the
  `next-app` profile starts, detects readiness from the child's stdout,
  restarts it with backoff on unexpected exit, and terminates its tree
  on stop. dsh's `webserver` carrier is not in the serving path.
- **Next is the only public HTTP surface** — pages, assets, and `/api`
  — and its API is **Next-native**: the browser never speaks dsh's
  internal envelope protocol. That protocol exists only behind `/api`;
  the app's data path is the bridge, which is the surface's only
  coupling to dsh.
- **The whole surface is guarded by HTTP basic auth at the Next
  edge**: one middleware fence covering every route including `/api`;
  a single user; credentials provisioned in the environment as a
  bcrypt hash; constant-time comparison; the native browser dialog, no
  session UI; a configurable realm so a deployment reverse proxy that
  also runs basic auth can share it (one dialog per origin).
- Rejected: the in-box architecture (recreates the CSR-only trait this
  repo exists to remove); an in-process custom-server embedding (loses
  `next start` production behavior and couples the app to host
  internals); carrying the envelope protocol into the browser (couples
  every surface to dsh's internal contract).

## Consequences

- One process owns HTTP semantics; dsh contributes a supervisor row
  and a private bridge listener, nothing a remote party can address.
- The app owns its security boundary; a reverse proxy is optional and
  additive, never required. v1 accepts plaintext credentials on
  non-TLS paths and no rate limiting; the single-user assumption is
  baked into v1.
- The gateway's HTTP Host/Origin fence can no longer be reached by a
  browser; the only fence the browser meets is this one.
- The in-box client-kernel ecosystem does not run here — that
  compatibility is deliberately out of scope for v1.
- Lock-in to Next.js/React for the life of the app; reversing means a
  rewrite of the UI layer only.
