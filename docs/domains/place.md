---
doc_type: domain
truth_scope: data
owner_boundary: domains/navigation/place
status: active
created: 2026-06-28
updated: 2026-07-10
---
# Place Catalog

## Boundary

This document defines the repo-owned campus place catalog boundary.

The catalog stores stable place identity, aliases, campus area, location
description and optional map bindings. It supports campus-map reads and future
navigation work. It is not an active chat tool, route planner, geocoder or RAG
collection.

Current facts:

- canonical record shape and seed posture live in `../data/place-catalog.md`
- navigation architecture lives in
  `../architecture/domains/navigation/architecture.md`
- browser map reads use `GET /api/campus-map/places` and
  `GET /api/campus-map/places/:placeId`
- no model-visible place tool or execution contract exists

## Map Binding

Each place can expose a point GeoJSON feature as its interaction center.
Places backed by campus base-map geometry may also expose `mapFeatureRefs[]`
with explicit `{ sourceId, layer, fid }` bindings.

Browser interaction must not infer canonical place identity from base-map
labels, nearest geometry, provider ids or free-form source references.

## Future Capability

A future place-finding or wayfinding capability must start from a product
requirement and add a real runtime owner, ToolSpec, strict payload/result
schema, projection contract and evaluation denominator. The catalog alone does
not reserve a tool id or make that capability available.
