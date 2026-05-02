---
doc_type: roadmap
status: active
created: 2026-05-02
updated: 2026-05-02
---

# Roadmap: Hub Product Entry And Legacy Wiki Identity

## Phases

- [x] **Phase 1: Product Hub Boundary And IA Freeze** - Define
  `hub.muc.wiki/[slug]` as the new product hub, keep `muc.wiki` MediaWiki as a
  sibling legacy service, and freeze route namespace, entry labels and capability
  availability states, plus the Worker + Vite React SPA implementation
  substrate.
- [x] **Phase 2: Identity Ownership And Legacy Wiki Compatibility Inventory** -
  Freeze app-api as canonical identity owner, define MediaWiki external identity
  linkage, inventory the current MediaWiki auth deployment, reject direct
  cookie/session/password-hash reuse, and document the initial compatibility
  mode plus any optional later account-linking or federation options.
- [x] **Phase 3: Hub Shell Foundation** - Add the hub browser surface, route
  shell, app launcher manifest/policy consumption, legacy Wiki card, and
  allowlisted same-site app-api seams through Worker `APP_API` Service Binding.
- [x] **Phase 4: Account Shell Relocation** - Move public account routes and UX
  framing to hub, keep app-api Better Auth backend, and convert chat-local auth
  routes into redirects or compatibility shims.
- [x] **Phase 5: Cross-Surface Navigation And Session Continuity** - Verify
  `/chat`, `/docs`, `/map`, `/services`, `/notices`, `/panel` entry behavior,
  return-to redirects, login/logout continuity and unopened-capability display
  policy.
- [x] **Phase 6: MediaWiki Link Metadata Pilot Gate** - Implement explicit
  `app_user <-> mediawiki_user` linkage only if Phase 2 admits account-link
  metadata; otherwise record the no-op/defer decision. Any implementation must
  include account conflict handling and operator audit projection without
  importing legacy passwords.
- [x] **Phase 7: Legacy Wiki Login Federation Decision Gate** - Evaluate whether
  to keep external-link-only compatibility or add hub/app-api as a future login
  identity provider for MediaWiki. Produce the decision and follow-up plan
  without content, media or account migration scope.
- [x] **Phase 8: Documentation, Guardrails And Acceptance** - Update product
  runtime, identity, current architecture, deployment/runbook docs and add tests
  that prevent hub from becoming a second auth backend or MediaWiki from leaking
  into execution identity.

## Exit Criteria

- `hub.muc.wiki/[slug]` is documented and implemented as product entry surface.
- Hub implementation uses Cloudflare Worker + Vite React SPA and stays aligned
  with existing public Worker surfaces.
- `muc.wiki` MediaWiki remains explicitly out of replacement scope.
- Legacy Wiki content and uploaded media remain served by `muc.wiki`.
- New app-set identity truth remains app-api-owned.
- MediaWiki compatibility path is explicit and reversible.
- Hub does not mirror, proxy, migrate or re-serve MediaWiki pages or uploaded
  media.
- Auth/session behavior is verified across hub and existing public surfaces.
- Unknown hub slugs fail closed instead of becoming implicit app-api proxies.
- Hub uses allowlisted same-site API seams to app-api through Worker Service
  Binding, not a generic proxy or second product backend.
- Legacy Wiki access remains an external sibling-service link unless a later
  explicit federation phase changes only MediaWiki login behavior.
