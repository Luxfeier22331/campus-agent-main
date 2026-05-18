---
doc_type: phase_plan
workstream: service-guide-lookup-question-coverage-hardening
phase: phase-4-app-api-public-chat-rendering-contract
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Plan: App-API Public Chat Rendering Contract

## Goal

Prove the browser-facing public/chat answer contract preserves service-guide focus, safe source URL
semantics and fail-close behavior.

## Inputs To Inspect

- `apps/app-api/test/chat-command.service.core.structured.suite.ts`
- `apps/app-api/test/chat-command.service.test.ts`
- `apps/app-api/src/**`
- `QUESTION-MATRIX.md`

## Tasks

1. Add app-api structured answer cases for entry, procedure and required-materials answers.
2. Add app-api fail-close rendering case for one missing requested field.
3. Assert source cards use user-facing `entry_refs.url` where available.
4. Assert provenance-only source refs are not rendered as action URLs.
5. Keep Vitest execution routed through `test/chat-command.service.test.ts`.
6. Update `MATRIX-COVERAGE-AUDIT.md` app-api rows.
7. Update `STATE.md` with Phase 4 evidence.

## Exit Criteria

- Public answer text matches the agent answer contract.
- Source URL/card rendering does not expose internal locators.
- Fail-close rendering does not invent missing facts.
- This phase does not require a live browser/staging public-chat smoke.

## Completion Evidence

- App-api structured answer coverage includes service-guide procedure, entry and full-guide answers
  in the campus-services structured tool path.
- Browser-facing finalization keeps user-visible labels and URLs while sanitizing raw internal
  source locators.
- Vitest entry remains `test/chat-command.service.test.ts`, matching the release gate command.

## Verification

```bash
pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/chat-command.service.test.ts -t 'renders campus-services answers from structured tool facts and safe source categories'
pnpm exec biome check apps/app-api/test/chat-command.service.core.structured.suite.ts
git diff --check -- apps/app-api .planning/workstreams/service-guide-lookup-question-coverage-hardening
```
