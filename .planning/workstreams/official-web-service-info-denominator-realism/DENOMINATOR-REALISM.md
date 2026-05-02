---
doc_type: design
status: active
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Denominator Realism

## Contact Directory

Release-blocking evidence:

- `phone`

Optional source-backed evidence:

- `email`
- `location`
- `office_hours`

Blocking structured fields:

- `organization_name`
- `phone`
- `source_url`
- `source_version_evidence`

Optional structured fields:

- `email`
- `location`
- `office_hours`

## Service Guide

Release-blocking evidence:

- `service_process`

Optional source-backed evidence:

- `service_entry`
- `service_material`
- `phone`
- `location`
- `office_hours`

Blocking structured fields:

- `service_name`
- `process_steps`
- `source_url`
- `source_version_evidence`

Optional structured fields:

- `service_entry`
- `required_materials`
- `responsible_office`
- `phone`
- `location`
- `office_hours`

## Status Semantics

- `present`: source-backed fact exists and may be materialized.
- `missing`: release-blocking required fact is absent.
- `source_not_provided`: optional fact was checked and the source does not publish it.
- `ambiguous`: extracted fact is contradictory or cannot be safely normalized.
- `not_applicable`: field does not apply to the target.

Only `missing` or `ambiguous` on release-blocking fields blocks selected-write readiness. Optional
fields with `source_not_provided` remain visible in operator projections but do not block release.
