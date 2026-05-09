---
doc_type: index
status: completed
created: 2026-05-09
updated: 2026-05-09
---

<!-- markdownlint-disable MD013 -->

# Workstream: Retrieval Intent Taxonomy Contract Closeout

这是 `retrieval-intent-taxonomy-contract-closeout` 的 native workstream 入口。

本 workstream 负责把 RAG query path 中分散的 query / answer / retrieval / synthesis 意图判断收口成
一个稳定的 `RetrievalIntent` 主轴。目标不是继续增加局部中文 cue、不是重开
`answer-ready semantic extraction rearchitecture` 的 evidence metadata 工作，也不是让 OpenAI Agents
SDK 接管检索规划。目标是让现有 answer-ready v3、typed answer draft、profile-gated reranker、
semantic replan、SDK synthesis 和 eval diagnostics 都由同一份 retrieval intent contract 驱动。

目标链路：

```text
user query
-> RetrievalIntent
-> evidence contract
-> retrieval plan / selector / budget
-> optional rerank policy
-> selection and replan policy
-> typed answer object
-> SDK synthesis / grounding
-> final AgentResponse
```

## Current Status

- status: `completed`
- current phase: `complete`
- current slice: Phase 0-9 implementation is now present in code. `RetrievalIntent` v1 owns covered
  serving-surface planning truth, answer-shape/typed-answer/runtime-SDK projections now consume that
  truth, retrieval-core consumes only intent-derived semantic hints, and `packages/evals` can render
  single-sample stage diagnostics from runtime artifacts.
- owner boundary:
  - `packages/rag-agent` owns `RetrievalIntent`, query planning, answer-shape projection, typed
    answer object projection, SDK synthesis projection and semantic replan policy.
  - `packages/retrieval-core` owns the existing typed `RetrievalPlan` / `RetrievalStep` executor
    seam, generic failure kinds and reranker execution policy; it must not import or own
    `RetrievalIntent`.
  - `packages/evals` owns intent/retrieval/answer diagnostics and guard coverage.
  - docs/contracts updates are limited to the existing internal RAG retrieval-plan seam.
- mandatory serving surfaces for the first closeout:
  - `regulations/student_rules`
  - `regulations/institutional_rules`
  - `curriculum/curriculum_plan`
  - `official_web/stable_reference`

## Why This Exists

Current worktree already has several pieces that are individually useful:

- answer-ready v3 evidence metadata and typed evidence attributes
- `HandbookQueryPlan.task_kind`
- `AnswerShape`
- `TypedAnswerDraft`
- RAG SDK `RagTaskKind`
- retrieval profile top-k / profile-gated reranker
- semantic replan failure kinds
- component eval and stage summaries

But these still form several partial truths. The same user query can be classified at multiple
layers:

- handbook query planning classifies it as `specific_policy_lookup`, `category_discovery` or
  `ambiguous_procedure`
- answer shaping infers `policy_list`, `condition_table`, `eligibility_judgment` or other answer
  shapes from query/evidence
- SDK synthesis maps query text again into `RagTaskKind`
- retrieval and replan apply failure kinds without a single expected evidence contract

This workstream fixes that structural gap by freezing `RetrievalIntent` as the single internal
contract that downstream components consume.

## Implemented Closeout

The current worktree has completed the substantive phase implementation:

- Phase 3: covered regulation answer-shape / typed-answer projection now follows
  `RetrievalIntent`; regulation fallback answer-shape inference no longer owns raw query cue
  parsing.
- Phase 4: covered planning surfaces emit intent-driven retrieval plans, need ids and semantic
  hints.
- Phase 5: selection and semantic replan consume intent-derived condition subject / evidence-role
  expectations instead of inventing a second truth from raw query text.
- Phase 6: reranker eligibility remains runtime-profile owned while respecting
  `retrieval_intent.expected.rerank_policy`.
- Phase 7: typed answer validation is checked against `retrieval_intent.expected.answer_kind`.
- Phase 8: `packages/evals` has a deterministic single-sample stage diagnostics runner:
  `intent -> plan -> retrieval -> rerank -> selection -> typed_answer -> synthesis -> grounding`.
- Phase 9: structure/guard tests now prevent covered-surface intent gaps, retrieval-core ownership
  drift and answer-shape regression toward regulation raw-query classifiers.

## Reopen Rule

Reopen this workstream only if:

- a covered serving surface starts returning `retrieval_intent=None` again;
- regulation answer-shape/runtime synthesis reintroduces raw-query primary classification outside
  retrieval-intent projection;
- retrieval-core regains a second primary query-intent truth instead of consuming only
  intent-derived semantic hints;
- typed answer validation can drift from `retrieval_intent.expected.answer_kind`; or
- new stage diagnostics stop attributing a single runtime sample through
  `intent -> plan -> retrieval -> rerank -> selection -> typed_answer -> synthesis -> grounding`.

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- review: `./REVIEW.md`
- contract freeze: `./CONTRACT-FREEZE.md`
- intent mapping: `./INTENT-MAPPING.md`
- phase plans: `./phases/*/PLAN.md`

## Relation To Existing Workstreams

- Builds on completed `answer-ready-evidence-contract-closeout`.
- Coordinates with active `answer-ready-semantic-extraction-rearchitecture`, but does not reopen
  ingestion metadata extraction or release adoption.
- Builds on completed `rag-agent internal Agents SDK loop` and active
  `openai-agents-sdk-native-supervisor-runtime-hardcut`, but does not introduce SDK-native types into
  the repo-owned retrieval intent or retrieval-plan seams.
- Builds on completed agentic retrieval workstreams, but does not reopen live source lookup,
  freshness, web search or unbounded retrieval.
- Does not change Go supervisor admission, query-enabled serving surface or public product API.

## Boundary Rules

- Go supervisor remains the admission / capability / workflow owner.
- `RetrievalIntent` is a repo-owned internal query-serving contract inside the RAG/retrieval seam;
  it is not a `packages/contracts` shared model.
- `RetrievalIntent` must not include SDK, provider, Qdrant, MinIO, object-store or model-specific
  types.
- retrieval-core consumes intent-derived `RetrievalPlan` / `RetrievalStep` fields, not
  `RetrievalIntent` itself.
- Retrieval intent cannot widen scope, authz, version selector or runtime profile.
- This workstream must not open `regulations/scoped_rules` by default.
- This workstream must not add public ToolSpec or new product surface.
- This workstream must not use one-off query cue patches as the target fix.

## Completion Rule

This workstream can close only when:

- `RetrievalIntent` is a versioned internal contract with tests.
- `HandbookQueryPlan.task_kind`, `AnswerShape`, SDK `RagTaskKind` and typed answer kind are all
  projections from `RetrievalIntent`.
- rag-agent derives retrieval plan, budget, selector, selection, semantic replan and optional
  rerank eligibility from `RetrievalIntent`.
- retrieval-core continues to execute typed retrieval plans and does not become an RAG intent owner.
- typed answer object is the internal primary answer artifact for supported regulation answer kinds.
- eval diagnostics can show intent -> plan -> retrieval -> rerank -> selection -> typed answer ->
  synthesis -> grounding for a single sample.
- guard tests prevent new independent intent inference in synthesis / answer shape / retrieval
  planning paths.
