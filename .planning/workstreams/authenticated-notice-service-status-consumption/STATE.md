---
doc_type: state
status: active
created: 2026-04-28
updated: 2026-04-28
workstream: authenticated-notice-service-status-consumption
---
# State: Authenticated Notice Service Status Consumption

<!-- markdownlint-disable MD013 -->

## Current Position

- status: `active`
- current phase: `Phase 8`
- current phase name: `Broader Live Family Coverage`
- current plan:
  `.planning/workstreams/authenticated-notice-service-status-consumption/phases/phase-08-broader-live-family-coverage/PLAN.md`
- total phases: `8`
- progress: `8/8 phases implemented; workstream remains active pending explicit archive decision`
- last activity: `2026-04-28`
- last activity description: Completed Phase 8 broader live family coverage.
  Real export notices `247726`, `352345`, `354502`, `354575`, `354674` and
  `354845` now have source/admission/projection/materialization disposition
  evidence across IT platform, library, service-counter and additional
  facility/hospital service-counter families.

## Current Slice

Phase 8 is implemented. Phase 7 already proved the first publishable real
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
- Broader family coverage has Phase 8 evidence for IT platform, library,
  service-counter and additional facility / hospital service-counter families.
- Do not use this workstream to absorb regulation, schedule, service guide,
  contact-directory or generic notice-query work. Those remain adjacent
  workstreams/surfaces.
- The workstream should remain active after Phase 8 and should not be archived
  without an explicit user decision.

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

- App API browser-facing structured answer verification passed:

```bash
pnpm --dir apps/app-api test:node -- chat-command.service.core.structured.suite.ts supervisor-adapter.response.suite.ts
```

- PG current/list smoke passed; evidence is under
  `evidence/phase-07-live-admission-loop/live-355650-facility-trial/`.
- Boundary rejection evidence for `355867` remains under
  `evidence/phase-07-live-admission-loop/live-355867-preview/`.
- Phase 8 source/admission/projection/materialization evidence captured under
  `evidence/phase-08-broader-live-family-coverage/`.
- Phase 8 summary:
  `phases/phase-08-broader-live-family-coverage/SUMMARY.md`.

- Claim lease is runtime-only and should be checked with:

```bash
uv run --all-packages python -m scripts.workstream_claim claim status \
  authenticated-notice-service-status-consumption
```

## Resume Instructions

Resume from the Phase 8 archive-decision point:

```bash
uv run --all-packages python -m scripts.workstream_harness codex shell \
  authenticated-notice-service-status-consumption
```

Then inspect:

```bash
sed -n '1,240p' \
  .planning/workstreams/authenticated-notice-service-status-consumption/phases/phase-08-broader-live-family-coverage/SUMMARY.md
```
