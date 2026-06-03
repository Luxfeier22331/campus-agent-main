---
doc_type: state
status: completed
created: 2026-04-28
updated: 2026-04-28
workstream: authenticated-notice-service-status-consumption
---
# State: Authenticated Notice Service Status Consumption

<!-- markdownlint-disable MD013 -->

## Current Position

- status: `completed`
- current phase: `Phase 9 completed`
- current phase name: `Current Release Composition And Safe Promotion`
- current plan:
  `.planning/milestones/ws-authenticated-notice-service-status-consumption-2026-04-28/phases/phase-09-current-release-composition-and-safe-promotion/PLAN.md`
- total phases: `9`
- progress: `9/9 phases complete; workstream archived`
- last activity: `2026-04-28`
- last activity description: Completed Phase 9 current release composition and
  safe promotion. PG current release is
  `service-status-current-20260428T122000`, with current records for `355650`
  and `354845`; the current object artifact was written for the same release,
  and historical Phase 8 candidates remain rejected-source evidence.

## Current Slice

Phase 9 is implemented. Phase 7 already proved the first publishable real
service-status notice (`355650`) can traverse
`notice_consumption_projection`, materialize into `campus_services/service_status`,
promote to the PostgreSQL current read model, and be consumed through
`service_status_lookup`, the app-api supervisor HTTP seam and the product answer
path.

Phase 8 then selected real authenticated notice export samples for IT platform,
library, service-counter and additional facility / hospital service-counter
status:

- `247726`: campus card / network fee / electricity recharge shutdown.
- `352345`: library holiday service arrangement.
- `354502`: comprehensive service hall holiday service adjustment.
- `354575`: campus hospital holiday duty arrangement.
- `354674`: information portal maintenance outage.
- `354845`: Fengtai campus hospital dermatology clinic opening.

All six selected samples now enter `campus_services/service_status_candidate`
admission and have typed materialization disposition evidence. Historical windows
are kept as preview/as-of evidence; `354845` is kept as current-preview evidence
without moving PG current truth.

Phase 9 composed the safe current release from current-effective service-status
records. It preserved the already published `355650` truth, added current
`354845`, rejected five historical Phase 8 candidates by effective window, and
promoted the staged release to the PostgreSQL current read model.

Phase 1 boundary artifacts exist:

- `BOUNDARY.md`
- `SELECTED-COHORT.md`
- `evidence/phase-01-selected-cohort/live-service-status-candidate-audit-2026-04-28.json`

Phase 1 live audit answered three questions:

1. Which service-status notice families are admitted into this workstream.
1. Which candidate cases are explicitly excluded because they belong to
   regulation, schedule, service guide, contact directory, or notice-level
   query.
1. Which selected notice ids form the first bounded service-status cohort.

## Known Starting Facts

- `notice-consumption-layer` is completed and already produces
  `campus_services/service_status_candidate`.
- Current taxonomy maps facility, facility/transport/classroom, IT platform,
  library, service status override, and transport commute families to
  `service_status_candidate`.
- Existing `build_service_status_projection` requires a consumer admission
  manifest and writes typed materialization output.
- Existing service-status materializer has been expanded from transport
  boarding-point / suspension heuristics to deterministic fixture coverage for
  IT platform, library, service counter and facility status.
- Existing structured projection publisher already has
  `service_status_read_model`.
- Existing Go runtime reads current release from PostgreSQL and fails closed
  when current truth is unavailable.

## Boundaries To Preserve

- Do not reopen `notice-consumption-layer`; use its candidate/admission truth.
- Do not absorb `authenticated-notice-regulation-consumption`.
- Do not duplicate transport timetable truth owned by the schedule line.
- Do not use generic RAG as service status backend.
- Do not let runtime query-time scan raw notice body/source truth.

## Current Gaps / Blockers

- No acceptance blocker remains for the first live service-status consumption
  loop: `355650` proves the end-to-end path.
- No acceptance blocker remains for current-release composition:
  `service-status-current-20260428T122000` proves safe multi-record current
  promotion.
- Do not use this workstream to absorb regulation, schedule, service guide,
  contact-directory or generic notice-query work. Those remain adjacent
  workstreams/surfaces.
- The explicit archive decision has been accepted. This workstream is now
  completed and archived under
  `.planning/milestones/ws-authenticated-notice-service-status-consumption-2026-04-28/`.

## Verification Status

- Planning files and Phase 7 evidence created.
- Live `355650` preview/stage/promote evidence captured under
  `evidence/phase-07-live-admission-loop/live-355650-facility-trial/`.
- Supervisor HTTP runtime evidence captured:
  `evidence/phase-07-live-admission-loop/live-355650-facility-trial/supervisor-service-status-lookup.json`.
- App API visible product answer evidence captured:
  `evidence/phase-07-live-admission-loop/live-355650-facility-trial/app-api-public-chat-service-status-smoke.json`.
- Full app-api -> supervisor HTTP -> PG current read model -> product answer
  E2E evidence captured:
  `evidence/phase-07-live-admission-loop/live-355650-facility-trial/app-api-to-supervisor-public-chat-e2e.json`.
- Local verification passed:

```bash
uv run --all-packages python -m unittest \
  tests.evals.intent_synthetic_suite \
  tests.ingestion.test_notice_derived_service_status_materialization \
  tests.ingestion.test_build_service_status_projection_worker \
  tests.ingestion.test_structured_projection_postgres \
  tests.agent.test_campus_services_agent
```

- Go runtime/http verification passed from `apps/supervisor-api`:

```bash
go test ./internal/runtimepolicy ./internal/structuredplanning ./internal/structuredquery ./internal/httpapi
```

- App API browser-facing structured answer verification passed with targeted
  test files:

```bash
pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts \
  test/chat-command.service.test.ts test/supervisor-adapter.test.ts
```

- The original Phase 9 plan command using suite module filenames was attempted,
  but Vitest did not filter by those non-test suite files and ran the broader
  node lane; it failed on an unrelated
  `official-web-local-projection-drain.test.ts` timeout.
- PG current/list smoke passed; evidence is under
  `evidence/phase-07-live-admission-loop/live-355650-facility-trial/`.
- Boundary rejection evidence for `355867` remains under
  `evidence/phase-07-live-admission-loop/live-355867-preview/`.
- Phase 8 source/admission/projection/materialization evidence captured under
  `evidence/phase-08-broader-live-family-coverage/`.
- Phase 8 summary:
  `phases/phase-08-broader-live-family-coverage/SUMMARY.md`.
- Phase 9 candidate audit, stage/promote, PG read-model, supervisor internal
  query and app-api/public-chat product smoke evidence captured under
  `evidence/phase-09-current-release-composition-and-safe-promotion/`.
- Phase 9 summary:
  `phases/phase-09-current-release-composition-and-safe-promotion/SUMMARY.md`.

- Workstream status should be checked with:

```bash
gsd-sdk query workstream.status authenticated-notice-service-status-consumption \
  --raw --cwd "$PWD"
```

## Resume Instructions

This workstream is completed. Reopen only through `.planning/WORKSTREAMS.md`
if the completed entry's reopen rule is met.

```bash
sed -n '1,240p' \
  .planning/milestones/ws-authenticated-notice-service-status-consumption-2026-04-28/phases/phase-09-current-release-composition-and-safe-promotion/SUMMARY.md
```
