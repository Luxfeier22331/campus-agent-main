---
doc_type: phase_plan
workstream: hub-product-entry-and-legacy-wiki-identity
phase: 08
phase_name: Documentation Guardrails And Acceptance
status: completed
created: 2026-05-02
updated: 2026-05-02
---

# Phase 08: Documentation, Guardrails And Acceptance

## Goal

Close the workstream by updating accepted architecture, adding regression
guardrails and verifying the deployed/local hub behavior against the frozen
boundary.

## Tasks

1. Update architecture docs:
   - product positioning
   - current architecture
   - product runtime architecture
   - identity and authorization architecture
2. Add guardrails for forbidden shapes:
   - hub as generic app-api proxy
   - hub as second auth backend
   - hub importing MediaWiki cookies/sessions/password hashes
   - hub proxying or re-serving MediaWiki content/media
   - `/wiki` as internal hub slug
3. Verify route and launcher behavior:
   - known slugs render expected entry state
   - unknown slugs fail closed
   - legacy Wiki card is external
4. Verify account route relocation and public-chat compatibility behavior.
5. Verify Worker build, typecheck and tests.
6. Update workstream state and completion criteria.

## Non-Goals

- Do not add new product capabilities during closeout.
- Do not open map/services/notices runtime surfaces.
- Do not change MediaWiki server configuration.
- Do not perform content/media/account migration.

## Acceptance Criteria

- Docs and implementation agree on hub as product entry surface.
- Tests prevent hub from becoming a generic proxy or second backend.
- Tests prevent MediaWiki identity leakage into app-api/supervisor/agent paths.
- All workstream phases are either completed or explicitly deferred with reason.
- Workstream is ready to mark complete.

## Verification Commands

```bash
pnpm --filter hub-web typecheck
pnpm --filter hub-web test
pnpm --filter hub-web build
pnpm --filter public-chat-web test
pnpm --filter app-api test
pnpm web:lint
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
- `.planning/WORKSTREAMS.md`

## Exit Rule

Phase 8 exits when hub is documented, tested and accepted as the product entry
surface without changing MediaWiki legacy-service ownership or app-api identity
ownership.
