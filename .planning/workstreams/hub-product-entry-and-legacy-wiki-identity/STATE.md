---
doc_type: state
workstream: hub-product-entry-and-legacy-wiki-identity
status: completed
created: 2026-05-02
updated: 2026-05-02
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** Phase 8 complete
**Current Phase Name:** Documentation, Guardrails And Acceptance
**Current Plan:** `ROADMAP.md`
**Total Phases:** 8
**Progress:** 8/8 phases complete
**Last Activity:** 2026-05-02
**Last Activity Description:** Implemented `apps/hub-web` as the
`hub.muc.wiki/[slug]` product entry surface, relocated the public account shell
into hub, converted public-chat auth URLs into hub redirects, documented the
legacy MediaWiki external-link posture, and added guardrails against generic
app-api proxying or MediaWiki identity leakage.

## Completed Result

- `apps/hub-web` is a Cloudflare Worker + Vite React SPA surface using TanStack
  React Router, Tailwind and lucide icons.
- Hub route namespace is implemented for `/`, `/account`, `/account/login`,
  `/account/register`, `/account/forgot-password`, `/account/reset-password`,
  `/chat`, `/docs`, `/map`, `/services`, `/notices` and `/panel`.
- Hub launcher uses a typed manifest with `available`, `preview`, `gated` and
  `external_legacy` states.
- Legacy Wiki is exposed only as `legacy-wiki` external card linking to
  `https://muc.wiki`; `/wiki` remains intentionally absent.
- Hub Worker only forwards allowlisted same-site app-api seams through `APP_API`
  Service Binding:
  - `/api/me`
  - `/api/auth/sign-in/email`
  - `/api/auth/sign-up/email`
  - `/api/auth/sign-out`
  - `/api/auth/get-session`
  - `/api/auth/request-password-reset`
  - `/api/auth/reset-password`
- Hub unknown API paths and unknown slugs fail closed.
- Hub account shell contains real email/password, password recovery, reset and
  Turnstile-backed forms that call app-api auth endpoints; hub does not create
  an auth backend or database.
- Hub Worker CSP admits Cloudflare Turnstile challenge script/frame origins, and
  staging deploy/preflight requires a real hub-scoped Turnstile sitekey supplied
  outside tracked config.
- `apps/app-api` can use `AUTH_SHELL_ORIGIN` for Better Auth browser shell
  origin while retaining `PUBLIC_CHAT_WEB_ORIGIN` as a trusted compatibility
  origin.
- `apps/app-api` readiness now reports auth shell origin and public-chat
  compatibility origin as separate configured dependencies.
- `apps/public-chat-web` keeps auth-family URLs only as bounded redirects/shims
  to hub account routes with explicit `return_to`.
- MediaWiki compatibility remains `external_link_only`; account-link metadata
  and login federation are deferred/no-op gates for this workstream.

## MediaWiki Live Inventory Snapshot

Read-only inspection through Windows OpenSSH alias `wiki` on 2026-05-02 found:

- host: `vultr.guest`
- live root: `/var/www/html`
- sibling candidate directory: `/var/www/mw142`
- public site: `https://muc.wiki`
- MediaWiki version: `1.36.1`
- web stack: nginx `1.22.1`, PHP-FPM `7.4`, MariaDB `10.3`
- auth posture: native MediaWiki account system; no enabled OAuth, OIDC, LDAP,
  PluggableAuth or CentralAuth path observed in live config
- site scale: 82 pages, 37 articles, 112 users, 39 images
- upload storage: `/var/www/html/images`, about 429 MB

This inventory is only for identity compatibility planning. It is not a content
or media migration inventory.

## Deferred / No-op Decisions

- Phase 6 account-link metadata runtime is not implemented because Phase 2 kept
  initial MediaWiki compatibility as `external_link_only`.
- Phase 7 legacy Wiki login federation is not implemented. Any future federation
  must reopen a dedicated workstream and use explicit MediaWiki auth extension /
  federation protocol; direct cookie/session/password-hash reuse remains
  forbidden.
- MediaWiki content, uploaded media and account migration remain out of scope.

## Verification

Latest focused verification:

```bash
pnpm --filter hub-web typecheck
pnpm --filter hub-web test
pnpm --filter hub-web test:worker
pnpm --filter hub-web build
STAGING_HUB_AUTH_TURNSTILE_SITE_KEY=0x4AAAAAAAstagingWidget pnpm --filter hub-web build:staging
STAGING_HUB_AUTH_TURNSTILE_SITE_KEY=0x4AAAAAAAstagingWidget pnpm --filter hub-web deploy:verify-config:staging
pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/auth-and-db.test.ts
pnpm --filter app-api exec vitest run -c vitest.node.config.mts test/worker.test.ts -t "declares the staging custom domain|serves healthz and readyz|fails readyz closed when runtime probes"
pnpm --filter public-chat-web exec vitest run test/public-chat-auth-regressions.test.ts test/public-chat-route-entry-parity.test.ts test/public-chat-sidebar-parity.test.ts
pnpm --filter public-chat-web exec vitest run test/worker.test.ts -t "declares the staging custom domain|redirects chat-local auth browser routes"
uv run --all-packages python -m unittest tests.test_check_worker_secret_presence tests.test_doctor_env tests.test_workspace_layout
```

Repository-level docs/lint verification is tracked in the closing session notes.

## Reopen Rule

Reopen only if `hub.muc.wiki/[slug]` route namespace, hub implementation
substrate, account shell ownership, app-api auth origin policy, MediaWiki
external-link-only posture, or generic proxy / identity-leak guardrails are
explicitly changed.
