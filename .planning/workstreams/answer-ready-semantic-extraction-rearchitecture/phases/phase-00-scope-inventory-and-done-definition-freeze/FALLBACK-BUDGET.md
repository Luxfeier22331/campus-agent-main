---
doc_type: phase_artifact
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Legacy Signal Budget: Old-Index Quarantine Only

## Rule

Target rebuilt v3 regulation releases have zero budget for primary text-cue reliance.

Legacy signal reads remain observable only for old-index quarantine diagnostics and safe historical
reads. They cannot satisfy workstream completion or query-serving admission.

## Fallback Classes

| Class | Allowed | Completion Credit | Required Diagnostic |
|-------|---------|-------------------|---------------------|
| `v3_typed_primary` | yes | yes | `fallback_used=false` |
| `v3_missing_optional_field_degraded` | only if non-serving or non-answer-ready | no | degraded reason and missing optional field |
| `old_index_public_semantic_fallback` | yes for quarantine reads | no | `fallback_primary_signal=public_semantic` |
| `old_index_public_content_role_fallback` | yes for quarantine reads | no | `fallback_primary_signal=public_content_role` |
| `old_index_text_cue_fallback` | yes only in legacy quarantine lane | no | `fallback_primary_signal=text_cue` |
| `target_v3_text_cue_primary` | no | no | test/release failure |

## Required Diagnostics

Every legacy-signal observation must include:

- `fallback_used`
- `fallback_reason`
- `fallback_primary_signal`
- `missing_contract_fields`
- `source_index_contract_version`
- `corpus`
- `collection`
- `release_id` or `physical_collection_name`

## Gate Behavior

- Release admission fails closed when query-enabled regulation chunks require v3 metadata and only
  legacy signals can classify them.
- Component eval fails when any oracle row on target v3 release uses `fallback_primary_signal=text_cue`.
- Legacy old-index reads may return legacy diagnostics but must not be counted in Phase 9/10
  acceptance.

## Removal Rule

Phase 11 must either:

- delete obsolete legacy-signal branches, or
- quarantine remaining legacy-signal reads under old-index-only code paths with tests proving target
  v3 cannot enter them.
