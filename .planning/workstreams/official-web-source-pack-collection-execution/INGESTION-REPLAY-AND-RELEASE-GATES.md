---
doc_type: plan
status: active
created: 2026-05-03
updated: 2026-05-03
---

<!-- markdownlint-disable MD013 -->

# Ingestion Replay And Release Gates

## Ownership

Ingestion owns replay, selected-write release tasks, stable-reference materialization / indexing /
publish execution and operator-safe release projection snapshots.

`apps/app-api` remains the official-web control plane owner for collector admission, run ledger,
artifact references, operator-safe query, ingestion handoff and stable-reference approve/reject
command ledger. It does not own selected-write task truth or release executor state.

## Replay Inputs

- source-pack manifest row
- source-truth bundle
- page manifests
- content blocks
- provider artifacts for diagnostics only
- target-source-map and consumer-denominator metadata

## Replay Outputs

Every source page must replay to one page-level status and zero or more projection outcomes.

Page-level status:

- `ready`
- `blocked`
- `deferred`
- `inventory_only`
- `excluded`

Projection outcomes:

- `service_guide_candidate`
- `contact_directory_candidate`
- `stable_reference_candidate`
- `regulation_reference_candidate`

No output may become current runtime truth without a release gate.

## Structured Selected-Write Gate

For `campus_services/service_guide`:

- required source-backed fact: service process or equivalent procedure.
- optional facts when source provides them: entry URL, material/download reference, phone, location,
  office hours.
- release must preserve source URL and field-level source references.
- missing optional fields should not block release.

For `campus_services/contact_directory`:

- required source-backed fact: phone under the current official-web contact denominator.
- optional facts when source provides them: location, office hours, responsibility scope.
- release must preserve organization name and source URL.

If a future source row needs email-only or another contact-channel-only release, that requires a
separate denominator decision before this gate can be relaxed.

## Stable Reference Gate

For `official_web/stable_reference`:

- page must be stable and answer-bearing.
- content blocks must preserve headings, lists and table-like structure.
- document materialization must keep source URL and canonical identity.
- row-specific table answers require deterministic row alignment; otherwise answer only as a
  source-location reference.
- app-api owns stable-reference approve/reject command ledger where that operator command path is
  used.
- ingestion owns materialization, indexing, publish execution and operator-safe release projection
  snapshots.

## Regulation Reference Gate

For `regulations/*`:

- page must carry formal rule, implementation rule or institutional policy semantics.
- materialization must not flatten rule pages into service-guide-only records.
- if scope is not opened for runtime serving, output remains release candidate or stable reference
  according to existing regulation release policy.

## Multi-Page Composition Gate

For a composition group such as `information_disclosure`:

- each component page is captured and replayed independently.
- composition is materialized offline by ingestion.
- component roles must be explicit, for example `policy_source`, `procedure_source`,
  `material_source`, `contact_source`.
- field-level output must retain source references to the component page that provided the field.
- runtime tools consume the composed projection; they do not query-time stitch component pages.

## No-Promotion Preview

Before any current-truth write, produce a preview report with:

- manifest row count
- captured page count
- replay output count by class
- page-level status count
- selected-write candidate count
- stable-reference candidate count
- blocked/deferred reasons
- source refs for every ready candidate
- exact write plan for current projections or document release candidates

Preview must be reproducible from source-truth artifacts without re-fetching source pages.
