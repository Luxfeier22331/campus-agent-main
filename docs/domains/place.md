---
doc_type: index
truth_scope: execution
owner_boundary: domains/navigation/place
status: active
created: 2026-06-28
updated: 2026-06-28
---
# Place Lookup

This is the canonical human document for the `place_lookup` /
`place_finding` narrow domain/tool surface.

## Boundary

`place_lookup` resolves campus place questions against repo-owned place catalog
truth. It is not route planning, map rendering, provider geocoding or generic
knowledge retrieval.

Current product posture:

- Go `apps/execution-control` owns `place_lookup` admission / framing and can
  use repo-owned `place_catalog` in the typed tool runtime.
- The browser product path still fails closed for `place_lookup` until the map
  product surface is explicitly opened.
- `place_card` / map consumption is outside this domain document until a
  product requirement and browser projection contract explicitly open it.

## Consumption

The intended tool consumption chain is:

```text
app-api -> execution-control -> admitted typed navigation tool
  -> repo-owned place_catalog
  -> PlaceLookupResult
```

Fixed constraints:

- `place_lookup` consumes `campus_navigation/place_catalog`; it must not
  synthesize place truth from generic retrieval chunks.
- `app-api` must not fake a retrieval collection scope to answer a place lookup.
- Ambiguous place aliases return clarification candidates, not a guessed top-1
  answer.
- Provider IDs, route polylines and route segments do not enter the place lookup
  result.

## Output Shape

The machine-readable payload/result fields are owned by
`../contracts/place-finding.md`.

Human-facing semantics:

- `completed`: one canonical place was resolved.
- `needs_clarification`: multiple plausible canonical places matched.
- `no_answer`: catalog truth cannot support an answer.
- `error`: runtime failed before a safe terminal answer.

When browser `place_card` rendering opens, it may show place name, entity
type, campus scope, location description, landmark hint, access/opening notes,
service tags, point geometry and source refs.

## Source And Storage

Place truth is repo-owned navigation data:

- canonical place facts live in `../data/place-catalog.md`
- navigation domain architecture lives in
  `../architecture/domains/navigation/architecture.md`
- shared DTO/result contract lives in
  `../contracts/place-finding.md`

`place_lookup` does not own route graph truth, current user location, profile
preferences, transport timetable truth or dining floorplan geometry.

## Browser Map Binding

`GET /api/campus-map/places` and
`GET /api/campus-map/places/:placeId` return campus metadata and place records.
Each place keeps a point GeoJSON feature as its interaction center.

Places backed by campus base-map geometry may also return `mapFeatureRefs[]`
with explicit `{ sourceId, layer, fid }` bindings. Those refs are the only
binding contract between a product place and rendered MapLibre features.

Browser interaction must not infer a place from base-map `name`, label text,
`sourceRefs` or nearest-geometry matching.

## Opening Rule

The product path can open `place_lookup` only when the map/navigation product
surface, runtime tool registry, strict schema, Go readiness and browser
projection contract all agree. Until then, keeping the browser path fail-closed
is the correct state.
