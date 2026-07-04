---
doc_type: architecture
truth_scope: execution
owner_boundary: domains/campus-services
status: active
created: 2026-04-23
updated: 2026-06-26
---
# Campus Services Runtime Architecture

## Boundary

`campus_services` is the projection-backed tool read model for repo-owned
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

## Transport Schedule Boundary

The current campus-services runtime only opens the transport timetable
surface. Its canonical human design doc is `docs/domains/transport.md`; this
architecture document only owns the campus-services runtime boundary and
opening gate.

## Opening Rule

A campus-services tool is open only when all registries agree:

- `configs/runtime/tools.v4.json` has `exposure: "model_visible"`
- `configs/runtime/tool-function-schemas.v1.json` has an available strict schema
- execution-control runtime profile `open_tools` includes the tool
- Go readyz/runtime tests and product-path gates pass

As of this document, only `transport_schedule_lookup` satisfies this rule.
Generic campus service status remains closed. It can reopen only as a newly
designed surface with its own contract, read model, runtime profile opening and
eval denominator; it must not inherit the removed generic status lookup path.
