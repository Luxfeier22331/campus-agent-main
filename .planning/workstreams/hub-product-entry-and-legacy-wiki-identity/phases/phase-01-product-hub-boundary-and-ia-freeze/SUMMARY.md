---
doc_type: summary
status: completed
created: 2026-05-02
updated: 2026-05-02
---

# Summary: Phase 01 Product Hub Boundary And IA Freeze

## Outcome

The product and information-architecture boundary for `hub.muc.wiki/[slug]`
is frozen.

Closed scope:

- `apps/hub-web` is the repo-owned product hub surface.
- The hub substrate is Cloudflare Worker + Vite React SPA + TanStack React
  Router.
- The route namespace is frozen for `/`, `/account`, `/account/login`,
  `/account/register`, `/account/forgot-password`, `/account/reset-password`,
  `/chat`, `/docs`, `/map`, `/services`, `/notices` and `/panel`.
- Legacy Wiki remains an external sibling service at `https://muc.wiki`; `/wiki`
  is intentionally not a hub app slug.
- Hub account shell ownership and app-api identity ownership are separated.

## Verification

Verified through architecture docs, hub manifest guardrails and source tests in
later phases.

## Residuals

No Phase 1 residual remains. Future route namespace or substrate changes must
reopen this workstream.
