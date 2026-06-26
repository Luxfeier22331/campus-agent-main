---
doc_type: architecture
truth_scope: capability
owner_boundary: domains/campus-services
status: active
created: 2026-04-23
updated: 2026-06-26
---
# Campus Services Runtime Architecture

## Boundary

`campus_services` is the projection-backed structured runtime for repo-owned
campus service facts. It is not a generic retrieval alias and does not own wiki
content.

Current model-visible surface:

- `transport_schedule_lookup`

Out of repo runtime scope:

- generic service status lookup / status override runtime
- service guides,办理指南, process guides and contact directory content
- wiki-maintained office/contact/process pages
- `calendar/academic_calendar` as a campus-services tool; calendar facts may
  exist as a data asset/prework collection, but not as a model-visible
  campus-services runtime tool

## Runtime Shape

Model-visible tool path:

```text
app-api -> execution-control -> Temporal activity
-> admitted typed tool -> internal query service
-> projection-backed structured truth
```

Browser status path:

```text
campus-web -> app-api facade/cache
-> execution-control internal projection endpoint
-> same projection-backed structured truth
```

Fixed constraints:

- query time never scans raw source bundles, notice HTML, object storage prefixes
  or generic retrieval chunks
- tool output is bounded JSON, not raw read-model rows
- `app-api` does not own campus-services transport schedule truth, rebuild the
  timetable, or maintain a second current pointer
- missing currentness, missing source truth, ambiguous route/date, or conflicting
  sources fail closed
- `navigation` may consume stop/place refs but does not own timetable truth
- `notice` owns notice discovery/change-set tools; campus services may consume
  admitted notice-derived transport overrides only through bounded projections

## Transport Schedule

`transport_schedule_lookup` reads `campus_services/transport_schedule`.

It answers:

- route direction and route family clarification
- first/next/last departure
- departure lists and timetable views
- service window and temporary suspension summary
- boarding stop references used by the UI/status page

The data plane is:

- `configs/ingestion/campus_services/transport_schedule/`
- `campus_services_projection_bundle.v1`
- PostgreSQL release catalog, current pointer and typed read model
- Go `apps/execution-control` internal query runtime

The status page consumes a materialized transport status projection from the
same current release through
`GET /internal/projections/campus-services/transport-schedule/status`; it must
not call `transport_schedule_lookup`.

## Opening Rule

A campus-services tool is open only when all registries agree:

- `configs/runtime/tools.v3.json` has `active: true`
- `configs/runtime/tool-function-schemas.v1.json` has an available strict schema
- `configs/runtime/capabilities.v1.json` lists it in `allowed_structured_tools`
- workflow artifacts bind it to supported Go runtime output
- Go readyz/runtime tests and product-path gates pass

As of this document, only `transport_schedule_lookup` satisfies this rule.
Future generic campus service status must be redesigned as a new surface instead
of inheriting the removed generic status lookup path.
