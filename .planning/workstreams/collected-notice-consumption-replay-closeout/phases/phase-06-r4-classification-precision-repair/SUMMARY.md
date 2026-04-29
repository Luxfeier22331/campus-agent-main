---
doc_type: summary
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 6R.4 Summary: Classification Precision Repair

## Result

Phase 6R.4 repaired the collected notice classification boundary that allowed
weak keyword hints to drive typed downstream admission.

The effective chain is now:

`searchable unit -> taxonomy-backed classification -> target-specific admission`

instead of:

`searchable unit -> weak keyword target_hints -> target admission`

## Evidence

Evidence is under:

`evidence/phase-06-r4-classification-precision-repair/`

Primary report:

- `classification-precision-audit-report.json`

Refreshed upstream/downstream evidence:

- Phase 4 searchable/reimport preview now includes `classification`.
- Phase 5 multimodal readiness uses classification-backed priority.
- Phase 6R.1 regulation admission/audit/trace was regenerated.
- Phase 6R.3 regulation materialization quality evidence was regenerated from
  the repaired admission manifest.

## Current Counts

These counts were superseded by Phase 6R.5 after a follow-up review found
target-level over-classification for transport and service-status candidates.
Use Phase 6R.5 evidence for current target counts.

## Boundary Changes

- Phase 4 `target_hints.candidate_targets` is now derived from
  `notice-family-classification.v1` routing, not direct keyword hits.
- Direct keyword hits are retained only as `weak_keyword_targets`.
- Phase 5 high-priority multimodal selection no longer trusts weak regulation
  keywords when a taxonomy classification is present.
- Phase 6R regulation admission now requires strong regulation eligibility
  before returning `needs_multimodal`.

## Validation

The precision audit verdict is `passed`.

False-positive probes such as tax filing, competition, procurement, and event
notices are retained for search but absent from regulation admission.

No DB writes, object-store writes, release publication, embedding, Qdrant writes,
or query-serving opening occurred.
