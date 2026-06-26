---
doc_type: contract
truth_scope: capability
owner_boundary: domains/campus-services
status: active
created: 2026-06-26
updated: 2026-06-26
---
# Transport Status

This contract defines the public status projection for the transport schedule
status page. Current scope is the campus shuttle timetable only.

## Boundary

Transport status is a product projection, not a model-visible tool.

- `campus-web` reads transport status to render the status page.
- `app-api` exposes the browser-facing public endpoint as a facade/cache only.
  It does not own transport schedule truth, rebuild the timetable, or maintain a
  second current pointer.
- `transport_schedule_lookup` remains the typed model-facing tool for intent
  questions such as next departure, service window and timetable lookup.
- Both surfaces consume the same `campus_services/transport_schedule` published
  release/read model through self-host execution-control/internal runtime
  endpoints.
- The status page must not call `transport_schedule_lookup`.

The first version does not support arbitrary date lookup. It shows the current
published effective timetable.

## API

```text
GET /api/campus-services/transport-schedule/status
```

The endpoint returns the current published status projection as cacheable JSON.
It reads the self-host internal projection endpoint and is not tied to a
frontend deployment:

```text
GET /internal/projections/campus-services/transport-schedule/status
```

The fixed consumption shape is:

```text
published transport schedule release/read model
  -> POST /internal/query/campus-services/transport-schedule
     -> transport_schedule_lookup
  -> GET /internal/projections/campus-services/transport-schedule/status
     -> app-api public status endpoint -> campus-web
```

If the current projection is missing, invalid or unverifiable, the endpoint
fails closed instead of generating a best-effort table at request time.

## Projection Shape

```ts
type TransportStatusProjection = {
  release: {
    releaseId: string;
    publishedAt: string;
    sourceRefs: string[];
  };
  groups: TransportStatusGroup[];
};

type TransportStatusGroup = {
  kind: "daily" | "weekday" | "weekend_holiday" | "temporary";
  routes: TransportStatusRoute[];
};

type TransportStatusRoute = {
  routeId: string;
  displayName: string;
  departures: TransportStatusDeparture[];
};

type TransportStatusDeparture = {
  departureTime: string;
  kind: "student" | "teacher" | "other";
  status: "normal" | "added" | "cancelled" | "changed" | "delayed";
  note?: string;
  sourceRefs: string[];
};
```

Array order is display order. The projection does not carry `label`, `order`,
route-level source references, stop refs, arrival time, release effective
windows or service date ranges.

## Display Semantics

Group kinds map to UI labels:

- `daily`: 每日运行
- `weekday`: 工作日运行
- `weekend_holiday`: 周末/节假日运行
- `temporary`: 临时安排

Empty groups are omitted.

Temporary changes are represented in the smallest display form:

- `cancelled`, `changed` and `delayed` rows remain in their baseline route when
  they can be matched there.
- `added` rows stay in the existing route when they belong to it.
- temporary routes or rows without a stable baseline route go under
  `temporary`.
- cancelled rows keep the original displayed departure time and use
  `status="cancelled"`.
- changed rows contain only the effective display information plus `note` and
  `sourceRefs`; the projection does not store original/effective diff fields.

## Source References

Source references exist only at two levels:

- `release.sourceRefs`: source URLs for the published timetable version.
- `departure.sourceRefs`: source URLs for the specific row or row-level change.

No group-level or route-level `sourceRefs` are defined in this version.
Internal notice refs such as `notice:muc_internal_portal:{notice_id}` may exist
inside the transport schedule read model, but the status projection must resolve
them through same-release `transport_release_notices.source_url` provenance and
only expose `http(s)` URLs.

## Storage And Validation

The status projection is materialized during transport schedule publish/release.
The first storage shape may be a current JSON blob associated with the published
transport schedule release inside the self-host execution-control/internal
runtime boundary. It should not be split into group/route/departure tables unless
a real query requirement appears.

The status projection and the typed transport schedule read model must share
`releaseId`, `publishedAt` and source references. They must not become separate
truths with separate current pointers.

The projection JSON is a contract and must be schema-validated at publish/read
boundaries. The machine-readable schema owner is:

```text
packages/contracts/schemas/transport-schedule-status.v1.schema.json
```

Frontend rendering should consume typed data and avoid duplicating the full
schema validator.

## Cache Semantics

The endpoint is cache-first because transport status changes through publish
events, not per request. Cache keys and ETags should include the current
`releaseId`. Publishing a new projection updates the self-host current
projection/read model and causes clients to observe the new version without a
frontend redeploy.

## Non-Goals

- Generic campus service status.
- `service_status_lookup` or any generic status tool.
- Arbitrary date query for the status page.
- Query-time route fan-out through `transport_schedule_lookup`.
- App-api-owned transport schedule database, rebuild job or current pointer.
- Query-time raw notice, object storage or HTML scans.
- Operator editing of the final status projection JSON.
