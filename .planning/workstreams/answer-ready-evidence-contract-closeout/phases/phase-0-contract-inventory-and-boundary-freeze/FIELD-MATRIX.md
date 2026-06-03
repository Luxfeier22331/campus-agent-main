---
doc_type: field_matrix
status: active
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Field Matrix: Contract Inventory And Boundary Freeze

Phase 0 inventory found that ingestion already produces several answer-ready fields, but online
retrieval projection exposes only the older subset.

## Inventory Matrix

| Field | Producer | Payload Key | Online Projection | Consumer | Eval / Gate | Current Status | Proposed Owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `answer_role` | `regulation_answer_roles.py`, `process_candidate_aggregation.py`, category overview | `metadata.answer_role` | missing from `EvidenceSource` | chunk quality counts only; ranking/selection cannot consume directly | `retrieval_chunk_quality.py` checks category/table/procedure cases | produced but not retrieval-facing | retrieval-internal projection in Phase 1; public `EvidenceSource` optional only if Phase 1 proves needed |
| `condition_subject` | not stable | none | missing | query focus/ranking uses cue-derived focus terms | no dedicated gate | missing | ingestion-core produces; retrieval-core projects internally; public contract optional |
| `parent_unit_id` | `root_unit_id`, member lineage | `root_unit_id`, `member_root_unit_ids` | missing; only `source_unit_kind/key` exists for some non-regulation cases | duplicate-parent suppression not typed | segment/root gates exist | implicit | retrieval-internal projection; public `EvidenceSource` optional |
| `evidence_contract_version` | stable for target rebuilt chunks | none | retrieval-internal accessor | release gate + chunk quality gate | retrieval/ranking/selection/draft/eval | emitted | ingestion-core emits `answer_ready_evidence.v2`; retrieval-core preserves internally |
| `semantic_role` | `handbook_semantics.py`, `regulation_answer_roles.py` | `metadata.semantic_role` | `EvidenceSource.semantic_role` | ranking, polarity conflict, selection | tests cover ranking metadata | exposed | keep public `EvidenceSource` |
| `claim_type` | `handbook_semantics.py`, table fact inference, answer roles | `metadata.claim_type` | `EvidenceSource.claim_type` | ranking, claim support | tests cover cannot_do/procedure/table | exposed | keep public `EvidenceSource` |
| `polarity` | `handbook_semantics.py`, answer roles | `metadata.polarity` | `EvidenceSource.polarity` | polarity-aware ranking/replan | retrieval tests cover positive/negative | exposed | keep public `EvidenceSource` |
| `action_type` | `handbook_semantics.py`, query cue inference | `metadata.action_type` | `EvidenceSource.action_type` | ranking/replan | retrieval tests cover `lift_discipline` / `reissue` | exposed but cue-derived | keep public; improve ingestion-origin values |
| `article_no` | `handbook_semantics.py`, anchor-derived value | `metadata.article_no`, `anchor.article_no` | `EvidenceSource.article_no` | focus matching | retrieval filter/focus tests | exposed | keep public |
| `clause_no` | `handbook_semantics.py`, anchor-derived value | `metadata.clause_no`, `anchor.clause_no` | `EvidenceSource.clause_no` | focus matching | focus tests | exposed | keep public |
| `section_kind` | `handbook_semantics.py` | `metadata.section_kind` | `EvidenceSource.section_kind` | weak evidence filtering | partial | exposed | keep public |
| `procedure_step_index` | not stable | none | missing | none | no gate | missing | retrieval-internal typed attributes |
| `procedure_actor` | not stable | none | missing | none | no gate | missing | retrieval-internal typed attributes |
| `procedure_action` | not stable | none | missing | none | no gate | missing | retrieval-internal typed attributes |
| `procedure_materials` | not stable | none | missing | none | no gate | missing | retrieval-internal typed attributes |
| `procedure_next_actor` | not stable | none | missing | none | no gate | missing | retrieval-internal typed attributes |
| `category_id` | `build_category_overview_metadata` | `metadata.category_id` | missing | handbook planning uses config, not retrieved evidence metadata | category overview gate checks role/titles only | produced for overview chunks | retrieval-internal typed attributes |
| `audience` | category overview as `category_audience`; `audience_scope` exists separately | `metadata.category_audience`, `metadata.audience_scope` | only `audience_scope` public | category discovery answer text | no stable category audience gate | partially produced | retrieval-internal `audience`; keep public `audience_scope` unchanged |
| `member_policy_document_ids` | category registry | `metadata.category_member_document_ids` | missing | handbook plan preferred ids from config | no online projection gate | produced for overview chunks | retrieval-internal typed attributes |
| `member_policy_titles` | category registry | `metadata.category_member_titles` | missing | statement filtering/text | chunk quality checks title presence | produced for overview chunks | retrieval-internal typed attributes |
| `condition_polarity` | not stable; overlaps `polarity` | none | missing | none | no gate | missing | retrieval-internal, defaults from `polarity` when safe |
| `condition_group_id` | not stable | none | missing | none | no gate | missing | retrieval-internal typed attributes |
| `member_segment_lineage` | `process_candidate_aggregation.py` | `metadata.member_segment_lineage` | missing | chunk quality only | segment coverage gate | produced for aggregated chunks | ingestion/release diagnostic; optional retrieval-internal for duplicate-parent suppression |

## Key Gaps

- `answer_role` is the biggest mismatch: generated at ingestion but invisible to online ranking.
- `condition_subject` and typed procedure attributes are absent, so current ranking relies on Chinese
  cue/focus rules for rank, paper and discipline examples.
- Category overview fields exist under `category_*` metadata names but are not a retrieval-facing
  evidence contract.
- Release gates validate generic chunk quality and some answer-role defects, but not the full
  answer-ready contract.
