---
doc_type: phase_plan
workstream: hub-product-entry-and-legacy-wiki-identity
phase: 03
phase_name: Hub Shell Foundation
status: completed
created: 2026-05-02
updated: 2026-05-02
---

# Phase 03: Hub Shell Foundation

## Goal

Implement the first repo-owned `apps/hub-web` browser surface for
`hub.muc.wiki/[slug]` using the frozen Worker-first substrate.

The phase must create the hub shell without turning hub into a second product
backend, a panel shell, a docs site or a MediaWiki proxy.

## Technology Contract

- runtime: Cloudflare Worker
- build/dev: Vite with `@cloudflare/vite-plugin`
- UI: React SPA
- routing: TanStack React Router
- styling/primitives: Tailwind, Radix primitives, lucide icons and existing
  public-facing UI conventions from `apps/public-chat-web`
- API seam: explicit allowlisted same-site API routes call `apps/app-api`
  through Worker `APP_API` Service Binding
- tests: worker runtime tests through `@cloudflare/vitest-pool-workers` and
  focused app launcher/browser-shell tests

## Tasks

1. Create `apps/hub-web` with package scripts aligned to existing Worker
   surfaces:
   - `dev`
   - `build`
   - `deploy`
   - `typecheck`
   - `test`
   - `test:worker`
2. Add Worker config for `hub.muc.wiki` route and `APP_API` Service Binding.
3. Implement static asset delivery and SPA route fallback.
4. Implement route shell for:
   - `/`
   - `/account`
   - `/chat`
   - `/docs`
   - `/map`
   - `/services`
   - `/notices`
   - `/panel`
5. Implement a controlled app launcher manifest with entry states:
   - `available`
   - `preview`
   - `gated`
   - `coming_soon`
   - `external_legacy`
6. Add the legacy Wiki external card linking to `https://muc.wiki`.
7. Add fail-closed unknown slug handling.
8. Add narrow allowlisted same-site app-api seams required by the shell,
   starting with:
   - `/api/me`
   - app launcher policy projection when available
   - auth route passthroughs only where Phase 4 requires them

## Non-Goals

- Do not implement account shell relocation in this phase.
- Do not implement MediaWiki account linking.
- Do not implement MediaWiki login federation.
- Do not proxy, mirror, migrate or re-serve MediaWiki pages or uploaded media.
- Do not add a generic app-api proxy.
- Do not use Next.js, Rspress, React Admin, MUI panel shell or Cloudflare Pages.

## Acceptance Criteria

- `apps/hub-web` builds and typechecks as a Worker + Vite React SPA.
- Hub route shell renders all admitted slugs and fails closed for unknown slugs.
- Hub launcher state is controlled by manifest/policy data, not route existence.
- The legacy Wiki card is an external link to `https://muc.wiki`.
- Hub same-site API calls are allowlisted and use `APP_API` Service Binding.
- Hub does not duplicate app-api auth/session/principal ownership.

## Verification Commands

```bash
pnpm --filter hub-web typecheck
pnpm --filter hub-web test
pnpm --filter hub-web build
pnpm web:lint
pnpm docs:lint
git diff --check
```

## Expected Write Set

- `apps/hub-web/package.json`
- `apps/hub-web/vite.config.ts`
- `apps/hub-web/wrangler.toml`
- `apps/hub-web/src/**`
- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/current-architecture.md`
- `.planning/workstreams/hub-product-entry-and-legacy-wiki-identity/STATE.md`

## Exit Rule

Phase 3 exits when hub has a deployable Worker shell with controlled route/app
launcher behavior and no unresolved substrate decision left for Phase 4.
