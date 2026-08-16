# ADR-0004: Auth in the app (basic auth first)

Status: Accepted

Date: 2026-08-16

## Context

dsh ships no authentication layer; its only protections are the loopback
bind and a Host/Origin trust fence. This app may run behind any reverse
proxy — or none — so its security boundary must not depend on one. Basic
auth is the starting point.

## Decision

v1 implements **HTTP basic auth inside dsh-next-app itself**: a single
user, credentials provided via environment variables (password as a
bcrypt hash), enforced by the app server before any request reaches
`/api`. No in-app login page or session UI in v1. The SSE transport
(ADR-0003) carries credentials on every browser, so streaming works
through the same gate.

## Consequences

- The app owns its security boundary; deployment behind any reverse proxy
  is optional and additive, never required.
- v1 accepts two gaps: credentials travel as plaintext basic auth on any
  non-TLS path (loopback/LAN), and there is no rate limiting. Password
  comparison is constant-time.
- Single-user assumption baked into v1 UI (no user switcher); multi-user
  would additionally require host-side decisions beyond this repo.
- The app must still handle upstream 401s gracefully: the dsh host keeps
  its own trust fence regardless of the app's auth.
