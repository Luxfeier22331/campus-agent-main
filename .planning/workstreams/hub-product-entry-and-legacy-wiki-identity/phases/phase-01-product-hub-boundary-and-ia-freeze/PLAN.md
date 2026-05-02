---
doc_type: phase_plan
workstream: hub-product-entry-and-legacy-wiki-identity
phase: 01
phase_name: Product Hub Boundary And IA Freeze
status: completed
created: 2026-05-02
updated: 2026-05-02
---

# Phase 01: Product Hub Boundary And IA Freeze

## Goal

Freeze the product and information-architecture boundary for `hub.muc.wiki/[slug]`
before implementation starts.

The phase must make it impossible to confuse:

- `hub.muc.wiki/[slug]` as the new app-set product hub
- `muc.wiki` as the existing MediaWiki sibling service
- `apps/app-api` as canonical product identity / session / principal owner
- `apps/supervisor-api` as internal execution engine only

## Tasks

1. Update product/runtime architecture to introduce `apps/hub-web` as the
   product hub surface.
2. Freeze the implementation substrate:
   - Cloudflare Worker runtime
   - Vite build/dev flow with `@cloudflare/vite-plugin`
   - React SPA browser shell
   - TanStack React Router for hub route shell
   - Tailwind/Radix/lucide public-facing UI conventions
   - Worker `APP_API` Service Binding for allowlisted same-site app-api seams
3. Freeze the route namespace:
   - `/`
   - `/account`
   - `/account/login`
   - `/account/register`
   - `/account/forgot-password`
   - `/account/reset-password`
   - `/chat`
   - `/docs`
   - `/map`
   - `/services`
   - `/notices`
   - `/panel`
4. Explicitly omit `/wiki` as an internal app slug. Hub should expose the
   legacy Wiki as an external card linking to `https://muc.wiki`.
   Hub must not mirror, proxy, migrate or re-serve MediaWiki page content or
   uploaded media.
5. Define entry states for each card:
   - `available`
   - `preview`
   - `gated`
   - `coming_soon`
   - `external_legacy`
6. Freeze app launcher ownership:
   - Phase 3 starts with a repo-owned typed static manifest
   - app-api policy projection is a later enhancement
   - hub does not infer capability opening from UI routes
   - unknown slugs fail closed to controlled not-found
7. Define account shell ownership:
   - browser shell moves to hub
   - app-api remains auth backend
   - public-chat auth routes become redirect/shim candidates for later phases
   - auth routes use explicit `return_to`
   - auth cookies are scoped to `hub.muc.wiki` with `Secure`, `HttpOnly` for
     server auth cookies and `SameSite=Lax`
   - no `.muc.wiki` shared auth cookie by default
   - MediaWiki account compatibility remains external-link-only until Phase 2
     explicitly admits account-link metadata
8. Identify all architecture docs that must be updated before implementation.

## Non-Goals

- Do not implement `apps/hub-web` in this phase.
- Do not change Better Auth configuration in this phase.
- Do not introduce Next.js, Rspress, React Admin, MUI panel shell or Cloudflare
  Pages as the hub implementation substrate.
- Do not implement MediaWiki account linking, SSO, account migration, content
  migration or media migration in this phase.
- Do not replace or proxy `muc.wiki`.
- Do not import MediaWiki uploaded media into repo object storage, ingestion or
  retrieval data-plane semantics.
- Do not open map/services/notices product capabilities beyond their existing
  runtime truth.

## Acceptance Criteria

- Product/runtime architecture has a clear hub surface boundary.
- Hub technology choice is frozen as Cloudflare Worker + Vite React SPA with
  TanStack React Router and Worker `APP_API` Service Binding seams.
- `muc.wiki` is documented as an external legacy sibling service, not an app slug
  owned by hub.
- Hub IA cannot be read as replacing MediaWiki.
- Hub IA cannot be read as a content or media migration entry point for
  MediaWiki.
- Hub IA cannot be read as a second app-api or auth backend.
- The route namespace and entry-state taxonomy are stable enough for Phase 3
  implementation.
- Account redirect and cookie posture are stable enough for Phase 4
  implementation.

## Verification Commands

```bash
pnpm docs:lint
pnpm yaml:lint
git diff --check
```

## Expected Write Set

- `docs/architecture/product-positioning.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/system/identity-and-authorization-architecture.md`
- `.planning/workstreams/hub-product-entry-and-legacy-wiki-identity/STATE.md`

## Exit Rule

Phase 1 exits when the product hub boundary is frozen in docs/planning and the
next implementation phase no longer needs to decide whether hub replaces
MediaWiki, owns auth truth, proxies unknown app slugs, or becomes a
content/media migration path.
