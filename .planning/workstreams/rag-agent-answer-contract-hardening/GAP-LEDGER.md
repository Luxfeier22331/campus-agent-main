---
doc_type: gap_ledger
status: completed
created: 2026-05-11
updated: 2026-05-11
---

<!-- markdownlint-disable MD013 -->

# Gap Ledger: Rag-Agent Answer Contract Hardening

## Completion Audit

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Title / identity queries must return one short identity-style answer instead of a summary chain | closed | `packages/rag-agent/src/campus_rag_agent/agent_answering.py`, `packages/rag-agent/src/campus_rag_agent/agent_answer_shape.py`, `tests/agent/rag_agent_short_answer_contract_suite.py`, `tests/agent/rag_agent_answer_quality_regression_suite.py` |
| Curriculum title lookup must stay on a one-fact identity-style path rather than a curriculum summary | closed | `packages/rag-agent/src/campus_rag_agent/agent_curriculum_answering.py`, `packages/rag-agent/src/campus_rag_agent/agent_answering.py`, `tests/agent/rag_agent_short_answer_contract_suite.py` |
| Official-web stable-reference brief answers must stay within a one-to-two fact budget | closed | `packages/rag-agent/src/campus_rag_agent/agent_official_web_answering.py`, `packages/rag-agent/src/campus_rag_agent/agent_official_web_reference_school.py`, `tests/agent/rag_agent_official_web_reference_suite.py`, `tests/agent/rag_agent_short_answer_contract_suite.py` |
| Generic fallback must collapse to a real fallback sentence instead of concatenating every fragment | closed | `packages/rag-agent/src/campus_rag_agent/agent_answering_generic.py`, `packages/rag-agent/src/campus_rag_agent/agent_answering.py`, `tests/agent/rag_agent_short_answer_contract_suite.py`, `tests/agent/rag_agent_presentation_contract_suite.py` |
| Typed draft validation must reject presentation/shape mismatches and overlong short answers | closed | `packages/rag-agent/src/campus_rag_agent/answer_presentation_contract.py`, `packages/rag-agent/src/campus_rag_agent/typed_answer_drafts.py`, `tests/agent/rag_agent_presentation_contract_suite.py`, `tests/agent/rag_agent_typed_answer_drafts_suite.py` |
| Runtime/eval diagnostics must expose presentation kind and fallback path/reason | closed | `packages/rag-agent/src/campus_rag_agent/service_answer_synthesis.py`, `packages/rag-agent/src/campus_rag_agent/service_diagnostics_payload.py`, `packages/rag-agent/src/campus_rag_agent/service_stage_diagnostics.py`, `packages/evals/src/campus_evals/rag_stage_diagnostics.py`, `packages/evals/src/campus_evals/ragas_diagnostic_runner.py`, `tests/evals/rag_stage_diagnostics_suite.py`, `tests/evals/ragas_diagnostic_runner_suite.py` |

## Residual Boundaries

- This closeout hardens short-answer presentation and diagnostics only; it does not reopen
  retrieval baseline, ingestion metadata extraction, reranker rollout policy, supervisor routing,
  or product surface ownership.
- Remaining broad `answer_relevancy` / `faithfulness` debt belongs to later retrieval or synthesis
  workstreams, not this contract-hardening line.
- The presentation schema stays package-local to `packages/rag-agent`; shared contracts only expose
  observability fields needed for diagnostics.
