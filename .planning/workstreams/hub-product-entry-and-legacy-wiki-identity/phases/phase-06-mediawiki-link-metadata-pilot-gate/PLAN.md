---
doc_type: phase_plan
workstream: hub-product-entry-and-legacy-wiki-identity
phase: 06
phase_name: MediaWiki Link Metadata Pilot Gate
status: completed
created: 2026-05-02
updated: 2026-05-02
---

# Phase 06: MediaWiki Link Metadata Pilot Gate

## Goal

Decide whether the workstream admits `app_user <-> mediawiki_user` link metadata.
The default outcome is no-op/defer unless Phase 2 has produced a concrete
account-link metadata contract and product need.

## Decision Inputs

- Phase 2 compatibility mode
- User-facing need for linking legacy Wiki account identity
- Operator audit requirement
- Conflict handling policy
- Privacy and consent posture

## Tasks

1. Re-read Phase 2 compatibility decision.
2. If Phase 2 did not admit account-link metadata, record a no-op/defer decision
   and skip runtime implementation.
3. If admitted, implement only external identity metadata:
   - app user id
   - external provider id: `mediawiki`
   - legacy wiki user reference
   - verification method and timestamp
   - operator audit fields
4. Add conflict handling:
   - one app user cannot silently claim multiple legacy accounts
   - one legacy account cannot silently link to multiple app users
   - operator-visible conflict state is sanitized
5. Add tests proving no MediaWiki password hash, cookie or session is imported.

## Non-Goals

- Do not migrate MediaWiki accounts.
- Do not import passwords or password hashes.
- Do not trust MediaWiki cookies or sessions.
- Do not implement MediaWiki login federation.
- Do not change MediaWiki server configuration.
- Do not migrate or proxy MediaWiki content or media.

## Acceptance Criteria

- Phase records either explicit no-op/defer or admitted link metadata runtime.
- Any admitted link metadata remains external identity metadata, not canonical
  app principal truth.
- No supervisor, agent or retrieval path receives MediaWiki identity internals.
- Tests cover conflict and forbidden-import cases if runtime is admitted.

## Verification Commands

```bash
pnpm --filter app-api typecheck
pnpm --filter app-api test
pnpm --filter hub-web test
pnpm web:lint
git diff --check
```

## Expected Write Set

- `apps/app-api/src/**`
- `apps/hub-web/src/**`
- `docs/architecture/system/identity-and-authorization-architecture.md`
- `.planning/workstreams/hub-product-entry-and-legacy-wiki-identity/STATE.md`

## Exit Rule

Phase 6 exits when account-link metadata is either explicitly deferred or
implemented without changing canonical app identity ownership.
