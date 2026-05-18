---
doc_type: requirements
status: active
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Requirements: Official Web Service Info Denominator Realism

## Goal

Make official-web service-info release gates realistic for public pages that provide only part of a
downstream answer while preserving fail-closed behavior for facts that are required to serve.

## Problem

The current config marks contact `phone/email/location/office_hours` and service
`service_process/service_entry/service_material/phone/location/office_hours` as equally required.
Real target-first pages do not always publish all of them:

- `https://www.muc.edu.cn/` publishes campus addresses and the main phone, but not email or office
  hours in the observed page footer.
- `https://xxgk.muc.edu.cn/info/1007/1113.htm` publishes the information-disclosure application
  process and responsible office, but not contact phone, location or office hours.
- `https://xxgk.muc.edu.cn/info/1007/1114.htm` publishes form download material, but not the full
  application process.

The fix must be a tracked machine contract change, not a prose relaxation.

## In Scope

- Add explicit optional evidence/fields to official-web consumer, target-source-map and
  target-inventory config models.
- Add `source_not_provided` as the normalized machine status for optional fields not present in the
  source.
- Require only release-blocking fields/evidence to be `present` for selected-write readiness.
- Preserve optional field visibility in app-api and protected panel projections.
- Update ingestion selected-write task admission and release execution to validate required and
  optional statuses separately.
- Keep source discovery target-first: homepage contact and information-disclosure pages only.

## Out Of Scope

- Broad host crawl.
- Human approval as the normal path.
- App-api current-truth mutation.
- Panel-side extraction or source parsing.
- Multi-page composition of process and form pages; the form page may remain blocked until a later
  composition design exists.
- Opening news or fresh official-web runtime surfaces.

## Success Criteria

- `contact_directory_candidate` has release-blocking `phone`; email/location/office_hours are
  optional source-backed evidence.
- `service_guide_candidate` has release-blocking `service_process`; entry/material/contact facts are
  optional source-backed evidence.
- Missing optional fields are represented as `source_not_provided`, not `missing`.
- Required fields/evidence still fail closed when absent.
- Selected-write release tasks carry required and optional denominator metadata.
- Release execution rejects missing required fields but accepts optional `source_not_provided`.
- App-api and panel expose optional denominator metadata without owning release mutation.
