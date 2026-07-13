---
doc_type: domain
truth_scope: execution
owner_boundary: domains/campus-services/transport
status: active
created: 2026-06-27
updated: 2026-07-12
---
# Transport

This is the canonical human document for the campus shuttle timetable
tool/domain. It replaces separate human docs for transport lookup, transport
status display and transport schedule source-truth prose.

## Boundary

Current scope is only the published campus shuttle timetable.

In scope:

- `transport_schedule_lookup`, the model-visible read-only SDK function tool.
- The campus-web services/status page transport timetable projection.
- Published transport schedule release metadata, source URLs, route rows,
  departure rows and row-level temporary changes.

Out of scope:

- Generic campus service status lookup.
- Service guides, contact directory, process guides or wiki-maintained pages.
- Arbitrary date query on the browser status page.
- Query-time scans of raw notices, HTML, object storage prefixes or retrieval
  chunks.

## Consumption

Both model and browser surfaces consume one release and current pointer in
`campus_services.*`; they use separate read shapes for their needs.

```text
validated publication input
  -> jobs/transport-publisher
  -> campus_services.transport_releases + transport_current
     -> app-api reads current status_json
        -> GET /api/campus-services/transport-schedule/status
        -> campus-web services/status page
     -> execution-control reads typed route/departure rows
        -> POST /internal/query/campus-services/transport-schedule
        -> transport_schedule_lookup
```

`app-api` is only the browser-facing status reader. Its database role can read
the current pointer and release status JSON, but not typed route/departure rows.
It must not publish transport truth, rebuild the timetable or maintain a second
current pointer. `execution-control` does not proxy the browser status path.

The status page must not call `transport_schedule_lookup`; it renders the
materialized status projection for the current published timetable.

The browser-facing app-api route returns the stored display projection and
cache validators. It must not expose execution-control `result_envelope`, raw
notice body, internal object locators or non-URL provenance refs.

## Tool

`transport_schedule_lookup` answers intent-first timetable questions:

- `next_departure`
- `first_departure`
- `last_departure`
- `departure_list`
- `service_window`
- `timetable`
- `schedule_snapshot_metadata`

The tool is open only when runtime registries, strict function schema,
workflow artifacts, Go runtime readiness and product-path gates agree. The
canonical machine-readable schema is
`packages/contracts/schemas/campus-services-tool-contracts.v1.schema.json`.

The tool fails closed when currentness, source truth, selector
disambiguation, temporal scope or projection readiness cannot be proven. It
must not fall back to generic retrieval, notice HTML scans, object-store scans
or browser-facing app-api loopback.

## Status Projection

The browser status endpoint is:

```text
GET /api/campus-services/transport-schedule/status
```

The display projection contains:

- release id, publish time and source URLs for the published timetable version
- display groups: `daily`, `weekday`, `weekend_holiday`, `temporary`
- route rows with ordered departure rows
- optional `serviceDate` on date-specific temporary rows
- row-level status: `normal`, `added`, `cancelled`, `changed`, `delayed`
- row-level source URLs for temporary or changed rows

The projection does not carry route-level sources, group-level sources,
arrival-time diffs, original/effective diff fields or operator-edited final
JSON. Temporary changes stay inside the baseline route when they match it;
only unmatched temporary rows go into the `temporary` group.

The canonical machine-readable status schema is
`packages/contracts/schemas/transport-schedule-status.v1.schema.json`.

## Source And Storage

The source channel is authenticated notice. `jobs/transport-publisher` accepts
a validated publication payload and writes a release atomically. Notice-derived
automation may prepare that payload, but query-time code never interprets a
notice. Published versions and row-level changes keep source URLs.

The transport domain stores normalized change/projection facts, not raw notice
content. Original notice content remains owned by the notice source channel.

Runtime consumption is DB/current-projection first:

- `campus_services.transport_releases`: release metadata and materialized status JSON
- `campus_services.transport_current`: the single current pointer
- `campus_services.transport_routes` and `transport_departures`: typed tool read model

Object storage may keep immutable release artifacts or archives, but it is not
the online consumption source of truth and must not be required for query-time
timetable reads.

## Update Rule

Publishing a new transport schedule release inserts the validated release rows
and moves the single current pointer in one transaction. The tool and browser
status endpoint observe the new release through that pointer; a frontend or
execution-control deployment is not required for timetable data changes.

If the current projection is missing, invalid or unverifiable, the tool and
status endpoint fail closed instead of generating a best-effort timetable at
request time.

This failure is local to the transport capability. A missing current release
must not fail execution-control, app-api, chat, memory, knowledge query or deployment
readiness when the PostgreSQL read-model connection itself is healthy. Until
notice ingestion is redesigned and a validated release is published, the
status endpoint returns unavailable and tool preflight remains blocked.
