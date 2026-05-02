---
doc_type: phase_plan
workstream: hub-product-entry-and-legacy-wiki-identity
phase: 07
phase_name: Legacy Wiki Login Federation Decision Gate
status: completed
created: 2026-05-02
updated: 2026-05-02
---

# Phase 07: Legacy Wiki Login Federation Decision Gate

## Goal

Decide whether `muc.wiki` should remain external-link-only or later trust
hub/app-api as a login identity provider. This phase is a decision gate, not a
MediaWiki server change.

## Tasks

1. Evaluate the current live MediaWiki posture:
   - MediaWiki `1.36.1`
   - native account system
   - no enabled OAuth/OIDC/LDAP/PluggableAuth/CentralAuth observed
2. Compare supported options:
   - keep external-link-only
   - add MediaWiki login federation through an explicit auth extension later
   - keep link metadata only if Phase 6 admitted it
3. Document why content, media and account migration remain out of scope.
4. Produce the follow-up plan only if federation is admitted.
5. Add guardrails that prevent federation work from modifying hub/app-api
   identity ownership by implication.

## Non-Goals

- Do not modify the live MediaWiki server.
- Do not install MediaWiki extensions in this phase.
- Do not implement SSO in this phase.
- Do not migrate accounts, content or media.
- Do not make app-api trust MediaWiki cookies or sessions.

## Acceptance Criteria

- The workstream has a clear decision: external-link-only or future federation
  follow-up.
- Any future federation scope is restricted to MediaWiki login behavior.
- No content, uploaded media or account migration is admitted.
- App-api remains the canonical new app identity owner.

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

Phase 7 exits when MediaWiki login federation is either deferred or admitted as
a separate follow-up that does not include content/media/account migration.
