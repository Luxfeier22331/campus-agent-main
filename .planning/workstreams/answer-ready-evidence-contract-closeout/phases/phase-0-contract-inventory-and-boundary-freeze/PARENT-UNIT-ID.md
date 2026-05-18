---
doc_type: parent_unit_id_decision
status: active
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Parent Unit Id Decision

Phase 2 must derive `parent_unit_id` from stable structural units, not from transient chunk order or
retrieval score.

## Current Facts

- Ingestion already carries `root_unit_id` on chunk metadata and uses it in chunk quality gates.
- Aggregated chunks preserve `member_root_unit_ids` and `member_segment_lineage`.
- Retrieval projection currently exposes `source_unit_kind` / `source_unit_key` for some curriculum
  cases, but not `parent_unit_id` for regulations.

## Decision

- Use `parent_unit_id` as the online retrieval-facing name for the stable answer context parent.
- For regulation text chunks, derive `parent_unit_id` from `root_unit_id` unless a narrower parent is
  explicitly available.
- For segmented article/list chunks, keep the same `parent_unit_id` across sibling segments and use
  `condition_group_id` or procedure attributes for child grouping.
- For aggregated chunks, preserve the lead `parent_unit_id` and expose `member_parent_unit_ids` as
  retrieval-internal metadata where needed for duplicate-parent suppression.
- For category overview chunks, use
  `<document_id>:category-overview:<category_id>` as the parent id.
- For table chunks, use the stable table root id as `parent_unit_id` and keep row/cell identity in
  table-specific metadata.

## Version / Edition Posture

- `parent_unit_id` should be stable within a document version and deterministic across rebuilds of
  the same source projection.
- `doc_id + version_id + parent_unit_id` is the unique answer-context identity.
- Do not include Qdrant physical collection, release id or chunk order in `parent_unit_id`.

## Migration Posture

- Old indexes without `parent_unit_id` remain readable.
- Rebuilt `student_rules` query-serving chunks covered by this workstream must carry
  `parent_unit_id`.
- Qrels that assert exact chunk ids should migrate toward document id plus expected answer role /
  condition subject where possible.
