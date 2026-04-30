---
doc_type: summary
status: completed
created: 2026-04-30
updated: 2026-04-30
---

# Phase 10 Summary: Regulation Serving Admission

## Result

Phase 10 completed controlled serving admission for the Phase 9 first-batch
regulation targets.

- `regulations/institutional_rules` is now default query-enabled.
- `regulations/scoped_rules` is retrieval-ready and indexed, but remains outside
  the default query allowlist.
- Public-chat citation remains closed.

## Evidence

- Provenance hardening:
  - `provenance-hardening.execute.json`: `updated_record_count=8`
  - `provenance-hardening.post-fix-dry-run.json`: `candidate_update_count=0`
- Chunk preparation:
  - `institutional_rules`: `document_count=1`, `chunk_count=26`, `validation_status=passed`
  - `scoped_rules`: `document_count=7`, `chunk_count=175`, `validation_status=passed`
- Qdrant release aliases:
  - `institutional_rules`: `point_count=26`, `published_at` populated
  - `scoped_rules`: `point_count=175`, `published_at` populated
- Reader assets:
  - `asset_count=32`
  - `document_count=8`
  - `gated_entry_count=8`
  - `public_entry_count=0`
- Retrieval smoke:
  - campus-member filter returns `3` institutional regulation sources
  - public filter returns `0` sources

## Guardrails Added

- Go runtime policy and execution tests cover institutional allowlist admission
  and scoped default rejection.
- Python drift tests cover regulation runtime profiles.
- Release-gate tests enforce mandatory chunk preparation and lane chunk-budget
  compatibility.
- Provenance hardening is idempotent after execution.
- Reader asset worker respects runtime profile `serving_revision_tracks`.

## Remaining Boundaries

- `scoped_rules` is not a default user-facing query scope.
- Public reader/citation exposure is still closed.
- Remaining blocked regulation candidates require separate admission after
  multimodal/manual-review gaps are resolved.
