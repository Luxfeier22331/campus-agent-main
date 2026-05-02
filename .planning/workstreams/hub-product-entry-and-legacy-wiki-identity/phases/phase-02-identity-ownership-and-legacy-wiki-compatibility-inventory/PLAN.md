---
doc_type: phase_plan
workstream: hub-product-entry-and-legacy-wiki-identity
phase: 02
phase_name: Identity Ownership And Legacy Wiki Compatibility Inventory
status: completed
created: 2026-05-02
updated: 2026-05-02
---

# Phase 02: Identity Ownership And Legacy Wiki Compatibility Inventory

## Goal

Freeze the identity ownership and legacy MediaWiki compatibility contract before
any account shell relocation or linkage runtime work starts.

The phase must preserve these boundaries:

- `apps/app-api` owns new product identity, session and principal truth.
- `muc.wiki` keeps its native MediaWiki account system unless Phase 7
  explicitly admits login federation.
- MediaWiki cookies, sessions, user tables and password hashes do not become
  app-api, supervisor-api or agent identity truth.
- MediaWiki page content and uploaded media remain out of hub scope.

## Inventory Evidence

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

This evidence is only for identity compatibility planning. It is not a content
or media migration inventory.

## Tasks

1. Update identity architecture docs to define MediaWiki as external legacy
   identity, not canonical app identity.
2. Define the initial compatibility mode. The default is
   `external_link_only` unless this phase explicitly admits a stricter shape:
   - `external_link_only`
   - `account_link_metadata`
   - `future_federation_candidate`
3. Define prohibited trust paths:
   - app-api trusting MediaWiki cookies or sessions
   - app-api importing MediaWiki password hashes
   - supervisor-api or agents reading MediaWiki identity state
   - hub reading MediaWiki database tables directly
4. Record the frozen cookie and session posture for `hub.muc.wiki`:
   - cookie names must not collide with MediaWiki cookies
   - app cookies are scoped to `hub.muc.wiki`
   - no `.muc.wiki` cross-subdomain auth cookie by default
   - no shared MediaWiki cookie domain/name/session
   - `Secure`
   - `HttpOnly` for server auth cookies
   - `SameSite=Lax`
5. Define account-link metadata shape at planning level only if this phase
   admits account-link metadata:
   - app user id
   - external provider id, fixed as MediaWiki
   - legacy wiki user id or username reference
   - verification method and timestamp
   - operator audit fields
6. Confirm no content/media migration scope:
   - no page export/import
   - no upload migration
   - no object-storage import from `/var/www/html/images`
   - no hub content proxy for legacy Wiki pages

## Non-Goals

- Do not implement account-link runtime in this phase.
- Do not implement SSO or MediaWiki federation in this phase.
- Do not implement account migration.
- Do not migrate MediaWiki page content.
- Do not migrate MediaWiki uploaded media.
- Do not modify the live MediaWiki server.

## Acceptance Criteria

- Identity docs state that app-api is the canonical new app identity owner.
- MediaWiki compatibility mode is frozen for Phase 3-6 implementation planning.
- Direct cookie/session/password-hash reuse is explicitly rejected.
- Content and media migration remain explicitly out of scope.
- Phase 6 either has an admitted account-link metadata contract or has a clear
  no-op/defer decision.

## Verification Commands

```bash
pnpm docs:lint
pnpm yaml:lint
git diff --check
```

## Expected Write Set

- `docs/architecture/system/identity-and-authorization-architecture.md`
- `docs/architecture/system/product-runtime-architecture.md`
- `.planning/workstreams/hub-product-entry-and-legacy-wiki-identity/STATE.md`

## Exit Rule

Phase 2 exits when the repo can implement hub account shell and optional legacy
account-link metadata, if admitted, without treating MediaWiki as canonical app
identity, depending on MediaWiki internals at runtime, or planning any MediaWiki
content/media migration.
