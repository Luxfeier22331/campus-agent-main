---
doc_type: phase_summary
status: completed
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Phase 0 Summary: Contract Inventory And Boundary Freeze

Phase 0 completed the read-only inventory and froze the implementation boundary for the answer-ready
evidence contract.

## Artifacts

- `FIELD-MATRIX.md`
- `CONTRACT-DECISION.md`
- `FALLBACK-DEPRECATION.md`
- `RELEASE-GATE-DECISION.md`
- `EVAL-CONTRACT.md`
- `TAXONOMY-GOVERNANCE.md`
- `PARENT-UNIT-ID.md`

## Code Facts

- `EvidenceSource` currently exposes `semantic_role`, `polarity`, `action_type`, `claim_type`,
  `audience_scope`, `article_no`, `clause_no`, `section_kind` and `is_answer_bearing`.
- `EvidenceSource` does not expose `answer_role`, `condition_subject`, `parent_unit_id` or
  `evidence_contract_version`.
- Ingestion already emits `answer_role` for procedure, exclusion, exception, eligibility,
  category overview and table fact paths.
- Category overview metadata is produced as `category_id`, `category_audience`,
  `category_member_document_ids`, `category_member_titles` and `answer_role=category_overview`.
- Aggregated chunks preserve `member_root_unit_ids` and `member_segment_lineage`, but online retrieval
  does not project a stable `parent_unit_id`.
- Runtime ranking/selection still has cue-driven fallback paths in evidence semantics, query focus
  and statement filtering.
- Existing release path can fail closed through `publish_scope_release -> evaluate_release_chunk_quality`,
  but the current gate does not enforce the full answer-ready contract.
- Existing SDK output validation has claim/list support validation, but typed answer draft must be
  the upstream structured representation and feed the existing claim/evidence graph.

## Frozen Decisions

- Phase 1 should implement retrieval-internal typed evidence projection/accessor first.
- Public `EvidenceSource` expansion is deferred unless Phase 1 proves a minimal scalar field must
  cross package boundaries.
- Rebuilt target `student_rules` cases have zero budget for primary text-cue fallback.
- Release fail-close must be wired into the existing regulation release path, not a standalone eval.
- `parent_unit_id` derives from stable `root_unit_id`/structural parent, not chunk order or release id.
- Component eval schema is frozen before Phase 1 to prevent late-stage boundary drift.

## Next Phase

Proceed to Phase 1: Evidence Contract And Payload Schema.

Phase 1 must:

- add typed evidence projection/accessor in `retrieval-core`
- preserve old indexes
- read new payload metadata when available
- keep backend/provider types out of `packages/contracts`
- add focused schema/projection tests.
