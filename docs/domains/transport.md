---
doc_type: contract
truth_scope: capability
owner_boundary: domains/campus-services/transport
status: active
created: 2026-06-27
updated: 2026-06-27
---
# Transport

This is the canonical human document for the campus shuttle timetable
capability. It replaces separate human docs for transport lookup, transport
status display and transport schedule source-truth prose.

## Boundary

Current scope is only the published campus shuttle timetable.

In scope:

- `transport_schedule_lookup`, the model-visible read-only typed tool.
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

Both model and browser surfaces consume the same published transport schedule
projection.

```text
published transport schedule projection
  -> POST /internal/query/campus-services/transport-schedule
     -> transport_schedule_lookup
  -> GET /internal/projections/campus-services/transport-schedule/status
     -> app-api facade/cache
     -> campus-web services/status page
```

`app-api` is only a facade/cache for the browser status endpoint. It must not
own transport schedule truth, rebuild the timetable or maintain a second
current pointer.

The status page must not call `transport_schedule_lookup`; it renders the
materialized status projection for the current published timetable.

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

It returns cacheable JSON from:

```text
GET /internal/projections/campus-services/transport-schedule/status
```

The display projection contains:

- release id, publish time and source URLs for the published timetable version
- display groups: `daily`, `weekday`, `weekend_holiday`, `temporary`
- route rows with ordered departure rows
- row-level status: `normal`, `added`, `cancelled`, `changed`, `delayed`
- row-level source URLs for temporary or changed rows

The projection does not carry route-level sources, group-level sources,
arrival-time diffs, original/effective diff fields or operator-edited final
JSON. Temporary changes stay inside the baseline route when they match it;
only unmatched temporary rows go into the `temporary` group.

The canonical machine-readable status schema is
`packages/contracts/schemas/transport-schedule-status.v1.schema.json`.

## Source And Storage

The source channel is authenticated notice. Transport schedule materialization
consumes admitted notice-derived transport candidates and keeps source URLs for
the published version and row-level changes.

The capability stores normalized change/projection facts, not raw notice
content. Original notice content remains owned by the notice source channel.

Runtime consumption is DB/current-projection first:

- release catalog
- current pointer
- typed transport read model
- materialized status projection

Object storage may keep immutable release artifacts or archives, but it is not
the online consumption source of truth and must not be required for query-time
timetable reads.

## Update Rule

Publishing a new transport schedule projection updates the self-hosted current
projection/read model. The tool and the browser status endpoint observe the
new release through the same current pointer; a frontend deployment is not
required for timetable data changes.

If the current projection is missing, invalid or unverifiable, the tool and
status endpoint fail closed instead of generating a best-effort timetable at
request time.
