---
doc_type: reference
truth_scope: eval
owner_boundary: packages/eval-langfuse
status: active
created: 2026-06-28
updated: 2026-07-13
---
# Eval

## Active Shape

Eval uses Langfuse for platform workflows and upstream Ragas for mature
scoring.

- `packages/eval-langfuse` is the TypeScript adapter and dataset owner.
- `packages/ragas-runner` is the only Python eval package and only executes
  upstream Ragas metrics.
- Runtime contract behavior stays in the owning app/package tests.
- The repo does not implement a separate release-gate framework.

`pnpm ci:eval` validates adapter and scorer behavior locally. It does not call
external models or prove a release. Turbo runs the Langfuse TypeScript
typecheck/tests and the isolated Ragas Python package task.

## Observation Sources

1. `GET /internal/execution/runs/:runId/steps` exposes
   `agent_runtime_eval_projection.v2` with `tool_trajectory.v2`, answer,
   retrieved contexts/document ids and resolved targets.
1. Langfuse traces provide correlated SDK and runtime observations.
1. The `agent-eval` runner executes versioned Langfuse dataset items through
   the real product path and links each target turn to its product trace with
   the official dataset-run-item API.
1. Repo assets provide expected answers, context ids, target sequence, history
   mode, outcome and search budget. A separate routing dataset supplies direct,
   function-tool and Knowledge Agent handoff expectations.

Raw prompt/provider/backend payloads are not observation sources for the safe
lane.

## RAG Metrics

The default Ragas metrics use `ragas.metrics.collections` and `ascore()`:

- `ragas.faithfulness`;
- `ragas.answer_relevancy`;
- `ragas.context_precision`;
- `ragas.context_recall`.

`ragas.context_precision_without_reference` is optional through runtime config.

The installed Ragas 0.4.x public collections API does not provide ID-based
context precision/recall. `reference_context_ids` and
`retrieved_context_ids` remain useful dataset/audit truth, but the repo does not
publish custom metrics under a `ragas.*` name or probe private Ragas APIs.

## Agent Metrics

Ragas agent scoring uses official:

- `ToolCallAccuracy`;
- `ToolCallF1`;
- optional `AgentGoalAccuracyWithReference`.

Tool calls are built from `tool_trajectory.v2`. The reference trajectory begins
with public `knowledge_query` and continues with the expected
`knowledge_search` sequence. Argument-aware scoring includes only eval-safe
`target` and `include_history`; query text remains excluded.

TypeScript publishes two deterministic BOOLEAN scores when their dataset truth
is present:

- `execution.outcome_match` compares the product terminal kind with
  `expected_outcome`;
- `retrieval.forbidden_context_absent` checks that no forbidden context id was
  retrieved.

Published score names must exist in the Langfuse score registry.

## Dataset Assets

Agent routing has one Langfuse dataset:

- `campus/agent/routing`.

It covers direct answers, transport tool selection, Knowledge Agent handoff and
target selection, conversation follow-up, mixed intent, unavailable
`official_web`, stale context and prompt injection. Expected trajectories use
name-only matching where arguments are not stable and eval-safe
`target`/`include_history` arguments for knowledge search.

Each RAG collection has one `cases.v1.json` and one Langfuse dataset:

- `campus/rag/student_rules`;
- `campus/rag/institutional_rules`;
- `campus/rag/curriculum`;
- `campus/rag/cross_target`.

One case contains the question, reference answer, reference context ids,
expected targets, expected outcome and expected search count. Optional fields
cover `setup_turns`, history mode, forbidden context ids and dataset split.
Setup turns run sequentially in the same conversation before the scored target
turn. Separate retrieval-denominator and answer-quality files are retired.

Coverage includes single-target, cross-target, conversation follow-up, explicit
historical/as-of/version-comparison questions, hard negatives, no-answer and
three-search-budget behavior.

## Platform Boundary

Langfuse owns datasets, experiments, scores, annotation queues and analytics.
The repo owns versioned case truth, safe projection and score registration.
Temporal owns production execution. App-api and Operator Console do not mirror
Langfuse score state into product tables.

The eval runner does not use Langfuse `runExperiment`: the real product request
already emits the canonical trace. It creates a dataset-run-item link for that
trace and retains the returned dataset run id as case lineage. Each published
score targets exactly one observation or trace through the synchronous
Langfuse scores REST API; dataset item/run ids are not copied into that score
payload.

Missing, `NaN` and infinite Ragas values are emitted as per-metric omissions,
never JSON scores. Runner output uses strict JSON encoding and the TypeScript
publisher rejects non-finite numeric values.

## Forbidden Shapes

- Recreate `packages/evals`, broad Python eval or custom experiment/review
  orchestration.
- Treat a Ragas score as a standalone release verdict.
- Invent ID metrics or custom scorers under upstream names.
- Store raw prompt, transcript, source body, provider response, auth material
  or local/object-store paths in safe samples or score metadata.

## Related Documents

- `eval-map.md`
- `eval-gold-truth-model.md`
- `../contracts/tool-trajectory.md`
- `../runbooks/eval-ragas.md`
