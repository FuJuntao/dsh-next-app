# ADR-0001: Next.js App Router shell (Server Components) + hydrated chat island

Status: Accepted

Date: 2026-08-16

## Context

The in-box dsh web UI is a client-side-rendered SPA (Vite build, static
`index.html`, 4.6 MB bundle) with no auth layer and weak mobile support.
These are architectural traits, not theme choices: no patch or
re-composition changes them. The surface must be server-rendered and
mobile-first.

## Decision

Build the replacement in **Next.js with the App Router and React Server
Components**:

- Server Components render the shell on first paint — session list,
  settings, static content — with live-updating surfaces (session list,
  forms) hydrating a small client bundle afterwards; a purely static
  session list would be stale by design
- a **hydrated chat island** for the live stream (a chat stream cannot be
  fully server-rendered; this is what production chat products do)
- mobile-first layout from day one (bottom-sheet composer, collapsible
  sidebar, touch-sized targets)
- component-level customization is deliberately out of scope for v1 —
  surfaces are the app's own, with no plugin override surface
- Rejected: plain React + Vite in the in-box's own architecture (recreates
  the CSR-only trait this project exists to remove); React Router 7
  framework mode (viable alternative — Next.js chosen for RSC maturity
  and ecosystem parity with the in-box React UI)

## Consequences

- Server Components give a fast server-rendered first paint; live
  surfaces still hydrate a client bundle, and the streaming core stays
  client-rendered by necessity.
- The in-box client-kernel ecosystem (`dsh.client` rows, client-side
  Cordis plugins) does not run here — that compatibility is deliberately
  out of scope for v1 (ADR-0002).
- React ecosystem parity with the in-box UI eases porting concepts (tool
  cards, approvals) where useful.
- Lock-in to Next.js/React for the life of the app; reversing means a
  rewrite of the UI layer only (the typed API client survives —
  ADR-0006).
