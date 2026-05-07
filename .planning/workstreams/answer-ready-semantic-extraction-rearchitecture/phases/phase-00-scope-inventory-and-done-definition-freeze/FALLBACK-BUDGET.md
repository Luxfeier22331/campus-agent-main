---
doc_type: phase_artifact
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Fallback Budget: Old-Index Compatibility Only

## Rule

Target rebuilt v3 regulation releases have zero budget for primary text-cue fallback.

Fallback remains allowed only for old-index compatibility, diagnostics and safe historical reads. It
cannot satisfy workstream completion.

## Fallback Classes

| Class | Allowed | Completion Credit | Required Diagnostic |
|-------|---------|-------------------|---------------------|
| `v3_typed_primary` | yes | yes | `fallback_used=false` |
| `v3_missing_optional_field_degraded` | only if non-serving or non-answer-ready | no | degraded reason and missing optional field |
| `old_index_public_semantic_fallback` | yes for old index reads | no | `fallback_primary_signal=public_semantic` |
| `old_index_public_content_role_fallback` | yes for old index reads | no | `fallback_primary_signal=public_content_role` |
| `old_index_text_cue_fallback` | yes only in legacy lane | no | `fallback_primary_signal=text_cue` |
| `target_v3_text_cue_primary` | no | no | test/release failure |

## Required Diagnostics

Every fallback observation must include:

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
  fallback can classify them.
- Component eval fails when any oracle row on target v3 release uses `fallback_primary_signal=text_cue`.
- Legacy old-index reads may return fallback diagnostics but must not be counted in Phase 9/10
  acceptance.

## Removal Rule

Phase 11 must either:

- delete obsolete fallback branches, or
- quarantine remaining fallback under old-index-only code paths with tests proving target v3 cannot
  enter them.
