---
doc_type: release_gate_decision
status: active
created: 2026-05-06
updated: 2026-05-06
---

<!-- markdownlint-disable MD013 -->

# Release Gate Decision: Answer-Ready Contract Admission

Phase 0 decision: answer-ready contract fail-close must be implemented in the existing regulation RAG
release path, not as a standalone eval.

## Chosen Hook

| Item | Decision |
| --- | --- |
| Release-admission module / CLI path | `registry_scope_release.publish_scope_release -> evaluate_release_chunk_quality` |
| Admission proof path | `regulation_rag_release_admission` manifest shape/validation records answer-ready gate status |
| Candidate processing path | `regulation_rag_release_lane.build_registry_scope_rag_release_executor` remains the owner for candidate execution |
| Required test owner | `tests/ingestion/test_index_release_acceptance.py` plus release-lane wiring tests where needed |
| Missing-field sample | query-serving `student_rules` chunk with `answer_role=eligibility_condition` but missing `condition_subject` and `evidence_contract_version` |
| Backward-compatible old-index posture | old indexes readable; publish/switch of rebuilt query-serving `student_rules` must fail |

## Current Path Facts

- `release_registry_scope` requires a release admission manifest key for query-enabled regulation
  releases before publish.
- `publish_scope_release` runs `evaluate_release_chunk_quality` before alias publication and fails if
  quality gate status is not `passed`.
- Current `evaluate_release_chunk_quality` checks generic metadata, heading-only chunks, table context
  and segment coverage, but not the full answer-ready evidence contract.
- `regulation_rag_release_admission` currently checks manifest shape/status and document identity, not
  answer-ready field coverage.

## Phase 5 Required Changes

- Extend `evaluate_release_chunk_quality` so `regulations/student_rules` query-serving chunks require:
  - `answer_role`
  - `parent_unit_id`
  - `evidence_contract_version`
  - `condition_subject` for judgment/condition chunks
  - typed procedure fields for procedure chunks where deterministic
  - category overview member metadata for category overview chunks.
- Extend release admission manifest policy/version to record answer-ready contract gate status.
- Add fail-close tests proving alias publish/switch cannot pass when required fields are absent.

## Non-Negotiable Constraint

Adding a standalone chunk quality eval is not enough. The same path that can admit or switch a
query-serving `student_rules` regulation RAG release must fail when required answer-ready contract
fields are missing.
