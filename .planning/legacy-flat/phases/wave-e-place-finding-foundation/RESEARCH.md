# Wave E / Place-Finding Foundation - Research

**Researched:** 2026-04-11  
**Scope:** Re-check frozen `navigation` / `place_lookup` boundaries and define the minimal correct first implementation posture.  
**Confidence:** HIGH for repo boundary facts, HIGH for provider/basemap policy, MEDIUM for final geometry normalization shape.

> Note: Wave E is currently referenced as a workstream, not a numbered `.planning/phases/*` phase. This memo is parked under a wave-local directory so it can be promoted later into a numbered phase folder without changing its content.

## Summary

The repo has already frozen the important boundary decisions. `place_lookup` / `place_finding` is the first forward slice; `route_planning` stays out. Canonical spatial truth belongs to repo-owned `campus_navigation/place_catalog`, not to provider payloads, not to browser map SDKs, and not to app memory. `navigation-specialist` is the correct capability owner, while `app-api` owns request ingress/projection and `public-chat-web` owns presentation.

Official external sources reinforce the current repo posture instead of changing it. GeoJSON is the correct neutral syntax for point-like geometry interchange, but provider IDs and provider response objects are not stable canonical truth: Google states Place IDs identify places in Google’s database and should be refreshed if older than 12 months; Mapbox documents `mapbox_id` and explicitly says response properties may change; Nominatim documents `place_id` as an internal database identifier that may differ between installations. For China-facing product surfaces, the compliance/basemap posture in `ADR-0028` is also aligned with current official sources: public OSMF tiles/Nominatim are not suitable as a production dependency, and a compliant keyed basemap capability such as Tianditu is the right first-step runtime choice.

**Primary recommendation:** implement Wave E around a repo-owned, institution-scoped `place_catalog` with stable canonical `place_id`, explicit geometry and provenance, adapter-only provider enrichment, text-first chat answers, and an optional single-point preview that consumes only normalized point geometry.

## Repo Facts

### Frozen Boundaries

- [Document fact] Navigation is a stable capability family, not a `rag-specialist` extension or supervisor inline tool. The long-term chain is `web surface -> app-api -> supervisor-api -> supervisor-core -> navigation-specialist -> spatial truth / provider adapters -> supervisor response`. Source: `docs/architecture/navigation-and-wayfinding-architecture.md:28-40`.
- [Document fact] `supervisor-core` owns routing and finalization, not alias business rules, route search, provider geocode logic, or map rendering. `navigation-specialist` owns place resolution, ambiguity handling, answer shaping, and provider fallback orchestration. Source: `docs/architecture/navigation-and-wayfinding-architecture.md:94-127`.
- [Document fact] `app-api` owns location permission input and request-scoped typed navigation projection. `public-chat-web` / `protected-panel-web` own map/card presentation only, not route correctness truth or canonical place truth. Source: `docs/architecture/navigation-and-wayfinding-architecture.md:129-149`.
- [Document fact] Canonical spatial truth is split into `campus_navigation/place_catalog` and `campus_navigation/route_graph`; provider responses must not become canonical truth. Source: `docs/architecture/navigation-and-wayfinding-architecture.md:169-188`, `docs/decisions/adr-0027-navigation-specialist-and-spatial-truth.md:52-70`.
- [Document fact] Current location is request-scoped situational context only. It must not be written into identity, authorization, or long-term memory truth. Source: `docs/decisions/adr-0027-navigation-specialist-and-spatial-truth.md:72-89`.
- [Document fact] Tile maps are presentation/runtime only. Provider-specific IDs, SDK types, and payload shapes must not enter shared contracts. Source: `docs/decisions/adr-0027-navigation-specialist-and-spatial-truth.md:108-144`.
- [Document fact] First ship is `place_lookup` / `place_finding`, with alias resolution, canonical place lookup, explanation text, location card, and optional point-level preview. Route planning, entrance selection, accessibility routing, and chat route interaction are explicitly deferred. Source: `docs/decisions/adr-0028-campus-navigation-basemap-and-provider-strategy.md:119-147`, `docs/plans/campus-place-finding-foundation.md:28-42`, `docs/plans/campus-place-finding-foundation.md:103-135`.

### Current Gap State

- [Document fact] The plan explicitly says the repo still lacks: repo-owned `place_catalog` source truth, alias-first place resolution execution, structured place-answer contract, and controlled location-card / point-preview UI. Source: `docs/plans/campus-place-finding-foundation.md:44-58`.
- [Document fact] Wave 1-4 expected work is: freeze catalog schema, build repo-owned seed/artifacts, add minimal `navigation-specialist`, then wire `contracts`, `supervisor-core`, `app-api`, and `public-chat-web`. Source: `docs/plans/campus-place-finding-foundation.md:137-249`.
- [Repo structure fact] `packages/navigation-specialist/` does not exist.
- [Repo structure fact] `configs/ingestion/campus_navigation/place_catalog/` does not exist.
- [Repo structure fact] A repo-wide keyword scan for `place_lookup`, `place_finding`, `point_geometry`, and `navigation-specialist` produced hits in docs only, not in `packages/*` or `apps/*`.

## Official External Facts

- [Official fact] RFC 7946 defines GeoJSON as a JSON geospatial interchange format with `Feature`/`Point` geometry semantics and WGS84 geographic coordinates. Source: https://www.rfc-editor.org/rfc/rfc7946.html
- [Official fact] Google documents Place IDs as identifiers for places in the Google Places database and recommends refreshing stored IDs if they are more than 12 months old. Source: https://developers.google.com/maps/documentation/javascript/place-id
- [Official fact] Mapbox documents `mapbox_id` in geocoding responses and notes that the geocoding dataset is continuously updated and response properties may be added or removed within the same API version. Source: https://docs.mapbox.com/api/search/geocoding/
- [Official fact] Nominatim documents `place_id` as the identifier in the internal database on the Nominatim server and says it may differ for the same place between installations. Source: https://nominatim.org/release-docs/3.3/api/Details/
- [Official fact] OSMF tile service is best-effort, has no SLA, and tells operators who cannot meet requirements to use alternatives or run their own service. Source: https://operations.osmfoundation.org/policies/tiles/
- [Official fact] OSMF Nominatim public service is capacity-limited, capped for heavy use, and apps must be able to switch service at OSMF’s request. Source: https://operations.osmfoundation.org/policies/nominatim/
- [Official fact] China’s 2024 notice requires APP map usage to follow map review/compliance procedures and explicitly points to standard maps / Tianditu as public supply paths. Source: https://www.gov.cn/zhengce/zhengceku/202405/content_6950568.htm
- [Official fact] Tianditu requires a development key and exposes keyed WMTS basemap services. Sources: https://lbs.tianditu.gov.cn/authorization/authorization.html and https://lbs.tianditu.gov.cn/server/MapService.html

## Recommendations

### 1. Canonical Place Truth Should Be Represented As

- [Document fact] The canonical truth layer is `campus_navigation/place_catalog`, not provider truth. Source: `docs/architecture/navigation-and-wayfinding-architecture.md:169-188`.
- [Document fact] The plan already froze the minimum field set: `place_id`, `entity_type`, `display_name`, `aliases`, `campus_scope`, `campus_area`, `location_description`, `point_geometry`, `coordinate_reference_system`, `service_tags`, `access_notes`, `source_refs`, `verification_state`. Source: `docs/plans/campus-place-finding-foundation.md:139-168`.
- [Recommendation] Treat each canonical place as a provider-neutral `PlaceRecord` with:
  - stable repo-owned `place_id`
  - institution-scoped alias list
  - explicit entity taxonomy
  - human-facing descriptive fields
  - explicit point geometry
  - explicit CRS / normalization provenance
  - source provenance and verification state
- [Recommendation] Use a two-layer geometry posture:
  - `place_catalog` artifact layer keeps explicit `point_geometry` plus `coordinate_reference_system` and provenance so source ingestion is auditable.
  - product-facing preview payload emits a normalized WGS84 point shape for map rendering, ideally GeoJSON-`Point` compatible, because that is the neutral web interchange standard.
- [Recommendation] Do not store raw provider feature blobs as canonical truth. Provider enrichment can be kept as adapter-private lookup material or provenance notes, but the canonical contract should stay stable when a provider changes.
- [Recommendation] For first ship, keep geometry strictly point-level. Do not model campus polygons, entrances, or route graph edges in the canonical contract yet.

### 2. Why Provider ID / Provider Schema Must Stay Out Of The Canonical Contract

- [Document fact] ADR-0027 already forbids provider-specific IDs, SDK types, and payload shapes from shared contracts. Source: `docs/decisions/adr-0027-navigation-specialist-and-spatial-truth.md:130-144`.
- [Official fact] Google Place IDs are scoped to Google’s database and require periodic refresh. That is adapter truth, not institution truth. Source: https://developers.google.com/maps/documentation/javascript/place-id
- [Official fact] Nominatim `place_id` is internal to a specific Nominatim server and can differ between installations. That makes it unfit as a repo-wide canonical identifier. Source: https://nominatim.org/release-docs/3.3/api/Details/
- [Official fact] Mapbox says response properties may change while the dataset is continuously updated. That makes provider response shape a bad shared-contract dependency. Source: https://docs.mapbox.com/api/search/geocoding/
- [Inference] Once a shared contract contains provider IDs or provider-shaped payloads, changing provider, mixing providers, self-hosting, or replaying seed data becomes a contract migration instead of an adapter swap. That directly violates the frozen repo boundary.
- [Recommendation] The only stable cross-surface identifier should be repo-owned `place_id`. If a provider ID is worth retaining, store it in adapter-private enrichment keyed by `place_id`, never as the public or supervisor-facing identity.

### 3. Minimal Correct Delivery Boundary For Chat `location card` / Single-Point Map Preview

- [Document fact] First ship requires text answer + location card; point-level preview is optional; route lines and full route interaction are out. Source: `docs/plans/campus-place-finding-foundation.md:120-135`, `docs/decisions/adr-0028-campus-navigation-basemap-and-provider-strategy.md:127-147`.
- [Document fact] Chat/map interaction must remain chat-first and map-enhanced, not a separate map product or bypass around `app-api`. Source: `docs/architecture/navigation-and-wayfinding-architecture.md:66-92`, `docs/decisions/adr-0027-navigation-specialist-and-spatial-truth.md:161-179`.
- [Recommendation] The minimum correct answer surface is:
  - explanation text that stands on its own
  - canonical `place_ref`
  - location card with `display_name`, `entity_type`, `campus_area` or nearby landmark, short location description, optional access/opening note, optional source refs
  - optional normalized single point for preview
- [Recommendation] The preview payload should be only enough to render one pin:
  - `place_id`
  - `display_name`
  - normalized point geometry
  - optional label text
  - nothing provider-specific
- [Recommendation] Keep renderer config, basemap key, WMTS/SDK wiring, and any coordinate conversion inside `public-chat-web` runtime code. `packages/contracts` should not know whether the preview is rendered via Tianditu, another compliant basemap, or no map at all.
- [Recommendation] If preview is absent, the response is still complete. If preview is present, it must not expand the contract into route preview, nearby search, or current-location ranking.

### 4. Missing Implementation Surfaces In The Current Repo

| Surface | Current status | Still missing | Recommended write targets |
| --- | --- | --- | --- |
| `configs` / data plane | Missing as repo structure fact | repo-owned `place_catalog` seed, alias index artifact, provenance / verification artifact | `configs/ingestion/campus_navigation/place_catalog/`, `packages/ingestion-core/` |
| `packages/contracts` | Missing by document fact + repo keyword scan | `place_lookup` handoff, canonical `PlaceRef`, `PlaceLookupResult`, `LocationCard`, optional point preview schema | `packages/contracts/`, `docs/contracts/navigation-place-finding-contract.md` |
| `packages/supervisor-core` | Missing by document fact + repo keyword scan | intent framing/routing for `place_lookup`, fail-close terminal wiring | `packages/supervisor-core/` |
| `packages/navigation-specialist` | Missing as repo structure fact | alias resolution, clarification, place lookup, answer shaping | `packages/navigation-specialist/` |
| `apps/app-api` | Missing by document fact + repo keyword scan | product ingress for `place_lookup`, typed request projection, response delivery ownership, optional selected-place/manual fallback input handling | `apps/app-api/`, `docs/contracts/app-api-http.md`, `docs/contracts/app-api-supervisor-execution.md` |
| `apps/public-chat-web` | Missing by document fact + repo keyword scan | location card rendering, optional single-point preview, no-route/no-provider-payload UI contract | `apps/public-chat-web/` |
| `docs` | Partially present | dedicated contract/data-plane doc for canonical place schema and preview payload, plus Wave E execution note | `docs/contracts/navigation-place-finding-contract.md`, `docs/data/campus-navigation-place-catalog.md`, `docs/reference/place-finding-preview-payload.md`, existing navigation ADR/plan files as needed |

## Suggested Repo Write Targets

- `configs/ingestion/campus_navigation/place_catalog/seed.v1.*`
- `configs/ingestion/campus_navigation/place_catalog/alias-index.v1.*`
- `packages/navigation-specialist/`
- `packages/contracts/`
- `packages/supervisor-core/`
- `packages/ingestion-core/`
- `apps/app-api/`
- `apps/public-chat-web/`
- `docs/contracts/navigation-place-finding-contract.md`
- `docs/data/campus-navigation-place-catalog.md`
- `docs/reference/place-finding-preview-payload.md`

## Bottom Line

- [Recommendation] Build Wave E around canonical place truth first, not around a map SDK or geocoder.
- [Recommendation] Make `place_id` the only cross-surface identity. Provider IDs stay adapter-private.
- [Recommendation] Ship text answer + location card as the product minimum. Single-point preview is optional and route-free.
- [Recommendation] The first code wave should start in `configs/ingestion` + `packages/contracts` + `packages/navigation-specialist`, then wire `supervisor-core`, `app-api`, and `public-chat-web`.

## Sources

### Repo Docs

- `docs/architecture/navigation-and-wayfinding-architecture.md`
- `docs/decisions/adr-0027-navigation-specialist-and-spatial-truth.md`
- `docs/decisions/adr-0028-campus-navigation-basemap-and-provider-strategy.md`
- `docs/plans/campus-place-finding-foundation.md`
- `.planning/PROJECT.md`
- `.planning/STATE.md`

### Official External

- RFC 7946 GeoJSON: https://www.rfc-editor.org/rfc/rfc7946.html
- Google Place IDs: https://developers.google.com/maps/documentation/javascript/place-id
- Mapbox Geocoding API: https://docs.mapbox.com/api/search/geocoding/
- Nominatim Details API: https://nominatim.org/release-docs/3.3/api/Details/
- OSMF Tile Usage Policy: https://operations.osmfoundation.org/policies/tiles/
- OSMF Nominatim Usage Policy: https://operations.osmfoundation.org/policies/nominatim/
- 中国地图合规通知: https://www.gov.cn/zhengce/zhengceku/202405/content_6950568.htm
- 天地图开发许可: https://lbs.tianditu.gov.cn/authorization/authorization.html
- 天地图地图服务: https://lbs.tianditu.gov.cn/server/MapService.html

## Confidence Breakdown

- Repo boundary facts: HIGH
- Provider-schema / provider-id separation reasoning: HIGH
- Basemap/compliance posture: HIGH
- Canonical geometry normalization detail: MEDIUM
