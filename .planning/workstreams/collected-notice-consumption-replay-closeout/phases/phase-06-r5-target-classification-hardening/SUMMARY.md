---
doc_type: summary
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 6R.5 Summary: Target Classification Hardening

## Result

Phase 6R.5 repaired the remaining target-level classification gaps found after
Phase 6R.4.

The current dry-run target counts are:

- `regulation`: `42`
- `transport_schedule`: `4`
- `service_status`: `3`

Transport target candidates now contain only true shuttle / commute schedule
notices. Classroom occupation, parking, non-motor-vehicle cleanup, and bathroom
notices no longer become `transport_schedule`.

Procurement, construction qualification, bid, maintenance procurement, and
award-result notices no longer become `service_status`.

File-release regulation taxonomy coverage now includes stable `工作办法`,
`评阅办法`, `评选办法`, `评定办法`, `考核办法`, `奖励办法`, `处理办法`,
`工作细则`, `成员规定`, and `行为规范` titles.

## Evidence

Evidence is under:

`evidence/phase-06-r5-target-classification-hardening/`

Primary report:

- `target-classification-hardening-audit-report.json`

Refreshed evidence:

- Phase 4 searchable/reimport preview.
- Phase 5 multimodal readiness.
- Phase 6R.1 regulation admission/audit/trace.
- Phase 6R.3 regulation materialization quality evidence.

## Current Counts

- searchable units: `338`
- multimodal candidates: `455`
  - high priority: `49`
  - normal priority: `406`
- regulation admission:
  - total entries: `42`
  - `file_release` entries: `42`
  - `notice` entries: `0`
  - downstream admitted: `8`
  - `needs_multimodal`: `32`
  - `manual_review`: `2`

## Validation

Focused tests passed:

- collected notice classification
- notice family classification
- collected notice reimport preview
- collected notice multimodal readiness
- collected notice regulation admission
- internal notice consumption projection routing

The Phase 6R.5 target-classification hardening audit verdict is `passed`.

No DB writes, object-store writes, release publication, embedding, Qdrant writes,
or query-serving opening occurred.
