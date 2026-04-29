---
doc_type: phase-summary
status: completed
created: 2026-04-27
updated: 2026-04-27
---

# Phase 1 Summary: Public Chat E2E Harness And Preflight

## Scope

Phase 1 fixed the first local product-path acceptance posture for
`public-chat-campus-services-e2e-acceptance`.

The selected default is repo-owned deterministic Worker tests:

- `apps/app-api` Worker/runtime tests for `/readyz` and supervisor readiness parsing
- `apps/public-chat-web` Worker tests for `/readyz` and same-site app-api bridging
- existing authenticated test-principal chat smoke for public-chat -> app-api request flow

Staging smoke remains later release evidence and is not the default Phase 1 harness.

## Implemented

- `app-api` supervisor readiness transport now parses supervisor `/readyz` payload:
  - `capability_gates.campus_services.open`
  - `structured_query_runtime.configured`
  - service status projection/read model readiness
  - transport schedule implementation/read model readiness
  - service guide projection/read model readiness
  - contact directory projection/read model readiness
- `app-api` `/readyz` now publishes `preflight.campusServicesProductPath` when the supervisor
  probe reports it.
- `public-chat-web` `/readyz` now forwards app-api `preflight.campusServicesProductPath`.
- The preflight status distinguishes:
  - `ready`
  - `blocked`
  - `not_reported`
- Blockers are keyed by specific gate/readiness checks, so Phase 2+ gates can diagnose whether
  the failure is capability gate, projection, or read-model readiness.

## Boundary

Phase 1 did not rebuild projections, change ingestion source-truth, or open staging/production
serving. It only made product-path readiness observable from the public/chat Worker path.

## Verification

Focused red/green and closeout commands run during Phase 1:

- `pnpm --dir apps/app-api test:node -- --runInBand test/supervisor-adapter.test.ts test/worker.test.ts`
- `pnpm --dir apps/public-chat-web test:worker -- --runInBand test/worker.test.ts`
- `pnpm --dir apps/app-api typecheck`
- `pnpm --dir apps/public-chat-web typecheck`
- `pnpm exec biome check apps/app-api/src/app/types.ts apps/app-api/src/modules/integration/index.ts apps/app-api/src/modules/integration/supervisor.ts apps/app-api/src/modules/integration/supervisor-transport.ts apps/public-chat-web/src/index.ts apps/app-api/test/supervisor-adapter.access.suite.ts apps/app-api/test/worker.test.ts apps/public-chat-web/test/worker.test.ts`
- `pnpm docs:lint`
- `git diff --check`

All focused Phase 1 commands passed after implementation.

Repo-wide `pnpm web:lint` was also attempted. It remains blocked by unrelated existing dirty
worktree files outside this phase, including staging smoke scripts, document reader tests,
public-docs CSS, and notice/runtime JSON formatting.

## Next

Phase 2 should add the positive routing and handoff matrix for:

- `service_status_lookup`
- `transport_schedule_lookup`
- `service_guide_lookup`
- `contact_directory_lookup`

Those tests should assert selected target, allowed tool / payload kind, structured result shape,
and enough answer/source trace to prove public/chat is consuming the intended tool.
