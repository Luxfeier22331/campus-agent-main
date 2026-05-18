---
doc_type: requirements
status: active
created: 2026-05-09
updated: 2026-05-09
---

<!-- markdownlint-disable MD013 -->

# Requirements: Retrieval Intent Taxonomy Contract Closeout

## Goal

Freeze and implement a single `RetrievalIntent` contract that drives RAG retrieval planning,
evidence expectations, optional reranking, selection, replan, typed answer drafting, SDK synthesis
and diagnostics.

## Problem Statement

The current RAG path has multiple partial intent truths:

- `HandbookQueryPlan.task_kind` handles regulation-specific planning.
- `AnswerShape` separately infers answer form from query and evidence.
- `TypedAnswerDraft.kind` is selected downstream from answer shape and selected rows.
- RAG SDK synthesis currently has its own `RagTaskKind` projection.
- retrieval plans, budgets, rerank policy and semantic replan triggers do not all share one
  expected evidence contract.

This makes the system harder to reason about: improving retrieval, typed answers, reranking or eval
can require changing several independent classifiers, and failures are difficult to attribute.

## In Scope

- Internal `RetrievalIntent` contract and versioning.
- Mapping from query planning to retrieval intent for:
  - `regulations/student_rules`
  - `regulations/institutional_rules`
  - `curriculum/curriculum_plan`
  - `official_web/stable_reference`
- Initial intent kinds:
  - `policy_list`
  - `policy_object_lookup`
  - `specific_clause_lookup`
  - `eligibility_judgment`
  - `procedure_steps`
  - `condition_table`
  - `version_compare`
  - `curriculum_fact_lookup`
  - `official_reference_lookup`
  - `general_fact_lookup`
  - `clarification_required`
  - `unsupported`
- Evidence expectation fields:
  - expected answer kind
  - expected evidence roles
  - condition subject
  - category id / member coverage expectation
  - document / article / clause target
  - critical terms
  - coverage policy
  - selection policy
  - rerank policy
  - replan policy
- RAG agent and eval updates needed to consume intent.
- retrieval-core updates only where the existing typed retrieval-plan seam needs intent-derived
  fields, generic failure kinds or reranker execution policy; retrieval-core must not import
  `RetrievalIntent`.
- Guardrails preventing parallel intent inference.

## Out Of Scope

- New query-enabled scope.
- Public API response expansion.
- Go supervisor capability or policy migration.
- Ingestion answer-ready v3 extraction changes except when a small fixture/test update is required
  to consume existing fields.
- Open-domain web retrieval, freshness/latest reopening, hosted tools, MCP tools, shell/code tools.
- Placing `RetrievalIntent` in `packages/contracts`.
- Provider-specific SDK types in any repo-owned retrieval intent or retrieval-plan contract.
- Changing product authz or runtime profile ownership.

## Success Criteria

- A versioned `RetrievalIntent` model exists and has serialization / validation tests.
- Query planning produces intent objects instead of relying on downstream query-text reclassification.
- `AnswerShape` is derived from `RetrievalIntent`, not independently inferred from query/evidence.
- RAG SDK query intent is derived from `RetrievalIntent`, not independently inferred from query text.
- Retrieval steps carry need ids and expected output derived from intent.
- `policy_list` uses category/member coverage expectations.
- `eligibility_judgment` requires judgment-capable evidence roles and condition subject alignment.
- `procedure_steps` requires procedure evidence and flags incomplete step coverage.
- `condition_table` requires condition/table/time/material rows with typed subjects where applicable.
- `specific_clause_lookup` preserves document/article/clause focus.
- `version_compare` preserves side-specific evidence expectations.
- selection and semantic replan consume intent expectations.
- retrieval-core continues to execute typed retrieval plans and does not infer primary RAG intent.
- reranker adoption can be enabled per intent/profile with explicit eval evidence; default global
  opening is forbidden.
- typed answer object is internally primary for supported regulation answer kinds.
- stage diagnostics can attribute failures to intent, plan, retrieval, rerank, selection, typed
  answer, synthesis or grounding.
- guard tests fail if synthesis / answer shape / retrieval planning reintroduce independent query cue
  classifiers.

## Negative Completion Criteria

The workstream is not complete if any of these are true:

- `AnswerShape` still independently parses query text for regulation answer kind.
- SDK synthesis still maps raw query text to task kind without the retrieval intent.
- retrieval planning still decides budget / selector / expected output from scattered cue checks.
- retrieval-core imports `RetrievalIntent` or starts classifying RAG task kind from raw query text.
- typed answer kind can disagree with retrieval intent expected answer kind.
- reranker can be enabled globally without intent/profile gate and eval evidence id.
- eval can only report final answer mismatch without stage attribution.
- new compatibility or fallback path is introduced to keep old classifiers alive.

## Verification Baseline

Expected verification lanes:

```bash
uv run --all-packages ruff check packages/rag-agent packages/retrieval-core packages/evals tests
uv run --all-packages ruff format <changed-python-files> --check
uv run --all-packages python -m unittest \
  tests.agent.rag_agent_service_structure_suite \
  tests.agent.rag_agent_typed_answer_drafts_suite \
  tests.agent.rag_agent_answer_quality_regression_suite \
  tests.agent.test_rag_retrieval_plan \
  tests.retrieval.retrieval_service_replan_execution_suite \
  tests.evals.answer_ready_component_eval_suite \
  tests.evals.retrieval_rerank_eval_suite \
  tests.supervisor.rag_agents_sdk_delegate_suite -q
```

Phase plans may narrow this set, but closeout must record fresh verification evidence. Broader
format checks should not be used as a phase blocker while unrelated baseline files remain
unformatted; each phase must at least run format check on files it changed.
