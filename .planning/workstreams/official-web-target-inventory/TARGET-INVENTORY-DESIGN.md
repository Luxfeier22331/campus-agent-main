---
doc_type: design
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Target Inventory Design

## Target Inventory Definition

An official-web target inventory entry is a downstream-owned collection objective.

It is more specific than a consumer family and more operational than a crawl seed:

```text
downstream question family
-> target inventory entry
-> app-api target candidate/job
-> collector target workset
-> source-truth artifacts
-> no-promotion preview
-> review / selected-write decision
```

## Canonical Home

Target inventory is a separate repo-tracked manifest:

```text
configs/sources/official_web/muc_public/target-inventory.json
```

It uses schema version `official_web_target_inventory.v1`.

`target-source-map.json` remains the family-level collection admission map. Inventory entries must
reference one of its targets through `admission_target_id`; they must not add page-level fields to
`target-source-map.json` unless a later architecture decision explicitly upgrades the
target-source-map schema.

## Minimum Entry Shape

Each non-inventory-only entry must declare the following repo-config fields:

- `inventory_id`
- `admission_target_id`
- `target_label`
- `consumer_family`
- `owner_surface`
- `owner_agent_or_runtime`
- `selected_write_target`
- `source_hosts`
- `source_urls` or deterministic URL discovery hints
- `required_fields`
- `required_evidence`
- `materialization_policy`
- `review_policy`
- `release_blockers`
- `preview_status`

`inventory_only=true` entries may omit `selected_write_target`, but must declare why they are not
eligible for selected write.

Runtime projections may use camelCase field names, but the repo-tracked manifest uses snake_case.
Validation must prove that `admission_target_id`, `consumer_family`, `owner_surface` and
`selected_write_target` are consistent with `target-source-map.json` and
`consumer-denominator.json`.

## Evidence Levels

Inventory records use two evidence levels:

- `source_locator`: public URL or deterministic locator used to discover a target candidate
- `replayable_source_evidence`: app-api run id, target job or attempt id, object keys, raw asset id
  and raw version id from a no-promotion preview

`source_locator` is enough to create a candidate. `replayable_source_evidence` is required before a
target can become `ready_for_selected_write`.

## Initial Field Families

### Service Guide

Required field candidates:

- service name
- applicable audience
- process steps
- required materials
- service entry or access path
- responsible office
- office location
- office hours
- contact method
- source URL
- source version evidence

### Contact Directory

Required field candidates:

- organization or office name
- phone
- email when present
- office location
- office hours when present
- source URL
- source version evidence

### Stable Reference

Required field candidates:

- reference title
- normalized content summary
- authoritative source URL
- page update evidence when present
- release scope
- owner surface

## Review States

Target inventory review states:

- `candidate`: target exists but has no current preview evidence
- `previewed`: no-promotion preview succeeded
- `blocked_fields`: source exists but required fields are missing
- `blocked_source`: source URL cannot be verified or fetched
- `blocked_lineage`: preview ran but app-api / source-truth lineage is incomplete
- `inventory_only`: retained for evidence but not eligible for selected write
- `ready_for_selected_write`: preview and field completeness pass
- `excluded`: explicitly rejected with reason

## Release Rule

This workstream may mark a target `ready_for_selected_write`, but it must not perform final current
truth promotion. Promotion requires a selected-write/release workstream or an explicitly admitted
phase that owns current read-model writes.
