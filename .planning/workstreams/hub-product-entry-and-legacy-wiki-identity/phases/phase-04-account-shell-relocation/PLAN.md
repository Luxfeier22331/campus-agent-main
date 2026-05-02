---
doc_type: phase_plan
workstream: hub-product-entry-and-legacy-wiki-identity
phase: 04
phase_name: Account Shell Relocation
status: completed
created: 2026-05-02
updated: 2026-05-02
---

# Phase 04: Account Shell Relocation

## Goal

Move the public account browser shell from chat-local framing into
`apps/hub-web`, while keeping `apps/app-api` as the canonical auth/session/
principal owner.

## Frozen Decisions

- Hub account routes:
  - `/account`
  - `/account/login`
  - `/account/register`
  - `/account/forgot-password`
  - `/account/reset-password`
- Public-chat auth routes become bounded redirects or compatibility shims.
- Redirects carry explicit `return_to` state.
- Hub auth cookie posture:
  - scoped to `hub.muc.wiki`
  - no `.muc.wiki` cross-subdomain auth cookie by default
  - no shared cookie domain/name/session with MediaWiki
  - `Secure`
  - `HttpOnly` for server auth cookies
  - `SameSite=Lax`

## Tasks

1. Implement hub account route pages using the existing public auth copy and
   app-api auth routes.
2. Add allowlisted same-site auth seams required by hub account routes.
3. Add `/api/me` consumption for account overview/session state.
4. Convert public-chat auth browser routes to redirects or bounded shims:
   - `/login`
   - `/register`
   - `/forgot-password`
   - `/reset-password`
5. Preserve public-chat answer/chat routes without making chat the auth owner.
6. Add tests for redirect `return_to`, cookie-domain posture and no MediaWiki
   cookie/session reuse.

## Non-Goals

- Do not change Better Auth canonical backend ownership.
- Do not introduce a hub-owned auth database.
- Do not add MediaWiki account linking or login federation.
- Do not remove public-chat compatibility routes until Phase 8 acceptance.

## Acceptance Criteria

- Hub owns public account browser shell routes.
- App-api remains the only canonical auth/session/principal backend.
- Public-chat auth route behavior is bounded and tested.
- Auth redirects do not require cross-subdomain cookie sharing.
- Hub cookies cannot collide with MediaWiki cookies by name/domain posture.

## Verification Commands

```bash
pnpm --filter hub-web typecheck
pnpm --filter hub-web test
pnpm --filter public-chat-web test
pnpm web:lint
git diff --check
```

## Expected Write Set

- `apps/hub-web/src/**`
- `apps/public-chat-web/src/login/**`
- `apps/public-chat-web/src/routes/**`
- `docs/architecture/system/identity-and-authorization-architecture.md`
- `docs/architecture/system/product-runtime-architecture.md`
- `.planning/workstreams/hub-product-entry-and-legacy-wiki-identity/STATE.md`

## Exit Rule

Phase 4 exits when users can start auth-family flows from hub and legacy
public-chat auth URLs no longer define product account ownership.
