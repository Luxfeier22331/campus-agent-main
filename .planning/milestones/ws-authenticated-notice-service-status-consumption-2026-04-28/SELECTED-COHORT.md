---
doc_type: cohort
status: active
created: 2026-04-28
updated: 2026-04-28
workstream: authenticated-notice-service-status-consumption
---
# Selected Cohort: Service Status Consumption

<!-- markdownlint-disable MD013 -->

## Live Projection Audit

Command:

```bash
uv run --all-packages campus-ingestion-list-internal-notice-service-status-candidates --limit 50
```

Initial result on 2026-04-28:

- live candidate count: `1`
- live service family coverage: transport-adjacent only
- live candidate:
  - `355867`
  - title: `关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知`
  - family: `facility_transport_classroom_status`
  - candidate kind: `transport_schedule`
  - target surface: `campus_services/service_status_candidate`
  - status: `ready_for_target_materialization`

Phase 7 bounded repair selected a real publishable service-status notice from
the authenticated notice collector export and re-admitted it through the
consumer admission manifest:

- live candidate:
  - `355650`
  - title: `关于静园10号楼负一层女浴室试运行的通知`
  - family: `facility_transport_classroom_status`
  - candidate kind: `service_status`
  - target surface: `campus_services/service_status_candidate`
  - status: `ready_for_target_materialization`
  - evidence:
    `evidence/phase-07-live-admission-loop/live-355650-facility-trial/`

## Selected Cohort

| Cohort kind | Notice id | Family | Candidate kind | Purpose |
| --- | --- | --- | --- | --- |
| live | `355867` | `facility_transport_classroom_status` | `transport_schedule` | Transport/schedule boundary check; must not let timetable facts leak into service status. |
| live | `355650` | `facility_transport_classroom_status` | `service_status` | Facility trial operation status; proves the first publishable live service-status admission and downstream consumption loop. |
| fixture | `353903` | `transport_commute_status` | `transport_schedule` | Boarding-point change becomes transport-adjacent status. |
| fixture | `355201` | `it_platform_service_status` | `service_status` | Information portal maintenance becomes IT platform status. |
| fixture | `355202` | `library_service_status` | `service_status` | Library opening-hour adjustment becomes limited service. |
| fixture | `355203` | `facility_service_status` | `service_status` | Service counter temporary closure becomes service counter status. |
| fixture | `355204` | `facility_service_status` | `service_status` | Self-study room closure becomes facility status. |
| fixture | `355205` | `it_platform_service_status` | `service_status` | Non-status service explanation is rejected. |

## Current Blocker

The first publishable live service-status loop is no longer blocked: `355650`
has been admitted, materialized, promoted and consumed downstream.

Broader family coverage remains future expansion, not the current stop-point
blocker. IT platform, library and service-counter examples stay covered by
deterministic fixtures until additional real notices are explicitly selected.

## Admission Expectation

- typed materialization must use `target_surface=campus_services/service_status_candidate`.
- selected/upsert mode is used for bounded notice ids.
- replace-scope mode is required before `--all-ready-service-status-candidates`.
- candidate taxonomy alone is not enough to publish runtime truth.
