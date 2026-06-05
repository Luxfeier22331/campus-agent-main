---
doc_type: contract_decision
status: active
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Contract Decision: Public And Internal Evidence Fields

Phase 0 decision: do not expand public `EvidenceSource` with every rich extraction field in Phase 1.
Add a retrieval-internal typed evidence projection/accessor first, then promote only the minimal
online fields that must be serialized outside retrieval/rag-agent.

## Decision Table

| Field | Public `EvidenceSource` | Retrieval-Internal Projection | Ingestion-Only Diagnostic | Decision Rationale |
| --- | --- | --- | --- | --- |
| `answer_role` | defer public promotion | required | no | Ranking, selection and typed drafts need it immediately; public serialization can wait. |
| `condition_subject` | defer public promotion | required | no | Needed for judgment/reranking; not yet a public response need. |
| `parent_unit_id` | defer public promotion | required | no | Needed for duplicate-parent suppression and support grouping. |
| `evidence_contract_version` | defer public promotion | required | no | Needed for legacy-signal and migration diagnostics. |
| procedure step attributes | no | required for `procedure_step` chunks | no | Complex structure should stay package-local until public need exists. |
| category overview attributes | no | required for `category_overview` chunks | no | Supports policy-list draft without bloating public source model. |
| condition group attributes | no | required where deterministic | no | Supports condition-table grouping; optional until extraction confidence is high. |
| `semantic_role / polarity / action_type / claim_type / article_no / clause_no / section_kind` | keep existing public fields | mirror in accessor | no | Already public and consumed by tests/runtime. |
| `member_segment_lineage` | no | optional | yes | Primarily release/eval diagnostic; online path only needs parent grouping summary. |

## Phase 1 Implementation Scope

- Add a retrieval-core module such as `evidence_attributes.py` that builds a typed
  `EvidenceAttributes` view from `EvidenceSource`, source metadata when available and old-field
  legacy fields.
- Add Qdrant payload resolvers for `answer_role`, `condition_subject`, `parent_unit_id`,
  `evidence_contract_version` and rich typed attributes.
- Do not add backend/vendor-specific shapes to `packages/contracts`.
- Public `EvidenceSource` additions are allowed only for minimal scalar fields if Phase 1 tests prove
  `rag-agent` cannot consume them through retrieval-internal projection without boundary leakage.

## Mandatory Online Projection Path

Every target field in `REQUIREMENTS.md` must be available to:

- retrieval ranking
- supporting evidence selection
- replan diagnostics
- typed draft construction
- component eval diagnostics

The path may be retrieval-internal, but it cannot be skipped.
