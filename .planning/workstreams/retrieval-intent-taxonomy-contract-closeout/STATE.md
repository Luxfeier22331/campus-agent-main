---
doc_type: state
status: completed
created: 2026-05-09
updated: 2026-05-09
---

<!-- markdownlint-disable MD013 -->

# State: Retrieval Intent Taxonomy Contract Closeout

## Current Position

**Status:** completed
**Current Phase:** complete
**Last Activity:** 2026-05-09
**Last Activity Description:** Phase 3-9 implementation landed. Covered regulation/curriculum/
official-web planning now emits a stable retrieval-intent truth; retrieval-core consumes only
intent-derived semantic hints; `packages/evals` gained runtime-derived stage diagnostics; guard
tests now block covered-surface intent gaps and regulation answer-shape classifier drift.

## Current Slice

Completed slice:

- covered serving surfaces are now routed through a single internal `RetrievalIntent` truth
- answer-shape / typed-answer / SDK synthesis projections consume retrieval-intent output instead of
  inventing parallel primary classifiers
- retrieval-core prefers intent-derived semantic hints and only fills legacy holes conservatively
- stage diagnostics can attribute a runtime sample through intent, plan, retrieval, rerank,
  selection, typed answer, synthesis and grounding
- guard coverage blocks retrieval-intent gaps and regulation answer-shape raw-query classifier
  regressions

Phase 0 artifacts:

- `CONTRACT-FREEZE.md`
- `INTENT-MAPPING.md`
- `REVIEW.md`

## Known Constraints

- Go supervisor remains admission and workflow owner.
- `RetrievalIntent` must stay inside the RAG/retrieval internal seam, not `packages/contracts`.
- retrieval-core must consume typed plan fields, generic failure kinds and reranker execution policy;
  it must not become a primary RAG intent classifier.
- `answer-ready semantic extraction rearchitecture` owns ingestion metadata extraction; this
  workstream only consumes those fields.
- `openai-agents-sdk-native-supervisor-runtime-hardcut` owns SDK-native semantic runtime hardcut;
  this workstream only ensures RAG SDK synthesis receives intent from repo-owned planning.

## Blockers

None recorded.

## Verification

Planning-only verification:

```bash
pnpm exec markdownlint-cli2 \
  '.planning/workstreams/retrieval-intent-taxonomy-contract-closeout/**/*.md' \
  '.planning/workstreams/retrieval-intent-taxonomy-contract-closeout/*.md'
```

Result: passed with `0 error(s)` on 2026-05-09.

Phase 1/2 verification:

```bash
uv run --all-packages python -m unittest \
  tests.agent.test_rag_retrieval_plan \
  tests.agent.rag_agent_handbook_category_discovery_suite \
  tests.agent.rag_agent_retrieval_intent_contract_suite \
  tests.agent.rag_agent_retrieval_intent_planning_suite -q
uv run --all-packages ruff check packages/rag-agent tests/agent
uv run --all-packages ruff format \
  packages/rag-agent/src/campus_rag_agent/retrieval_intent.py \
  packages/rag-agent/src/campus_rag_agent/handbook_query_planning.py \
  packages/rag-agent/src/campus_rag_agent/curriculum_query_models.py \
  tests/agent/rag_agent_retrieval_intent_contract_suite.py \
  tests/agent/rag_agent_retrieval_intent_planning_suite.py --check
```

Result: passed on 2026-05-09.

Phase 3-9 focused verification:

```bash
uv run --all-packages python -m unittest \
  tests.agent.rag_agent_retrieval_intent_planning_suite \
  tests.agent.rag_agent_service_structure_suite \
  tests.agent.rag_agent_sdk_contract_suite \
  tests.agent.rag_agent_typed_answer_drafts_suite \
  tests.agent.rag_agent_agentic_runtime_contract_suite \
  tests.agent.rag_agent_agentic_depth_runtime_suite \
  tests.agent.test_rag_retrieval_plan \
  tests.retrieval.retrieval_service_replan_execution_suite \
  tests.retrieval.retrieval_core_structure_suite \
  tests.evals.rag_stage_diagnostics_suite -q
uv run --all-packages ruff check \
  packages/rag-agent/src/campus_rag_agent/agent_answer_shape.py \
  packages/rag-agent/src/campus_rag_agent/service_pipeline.py \
  packages/evals/src/campus_evals/rag_stage_diagnostics.py \
  tests/agent/rag_agent_retrieval_intent_planning_suite.py \
  tests/agent/rag_agent_service_structure_suite.py \
  tests/evals/rag_stage_diagnostics_suite.py
uv run --all-packages ruff format \
  packages/rag-agent/src/campus_rag_agent/agent_answer_shape.py \
  packages/rag-agent/src/campus_rag_agent/service_pipeline.py \
  packages/evals/src/campus_evals/rag_stage_diagnostics.py \
  tests/agent/rag_agent_retrieval_intent_planning_suite.py \
  tests/agent/rag_agent_service_structure_suite.py \
  tests/evals/rag_stage_diagnostics_suite.py --check
```

Result: passed on 2026-05-09.

## Continuity Notes

- Do not reopen this line for generic RAG quality work; the remaining metadata/chunking/rerank/eval
  quality items belong to separate workstreams.
- New covered serving surfaces or new retrieval-intent kinds should open a new workstream or a
  follow-up slice rather than silently extending this completed one.

Broader `uv run --all-packages ruff format packages/rag-agent tests/agent --check` still reports
pre-existing unrelated files that would be reformatted; this workstream only formatted files it
changed.

Full `pnpm docs:lint` was also checked and currently fails on an unrelated pre-existing markdown
line-length issue:

- `infra/otel/README.md:27:81 MD013 line-length`
