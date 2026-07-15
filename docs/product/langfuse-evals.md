---
doc_type: product_requirement
truth_scope: product
owner_boundary: docs/product
status: active
created: 2026-06-19
updated: 2026-07-13
---
# Langfuse Evals

## Goal

Engineering and Eval/QA can inspect the same trace, dataset run, Ragas scores
and review workflow without creating a second eval platform in the repository.

## Requirements

- Online Agent SDK and execution spans correlate by W3C trace identity.
- Repo RAG cases sync to one Langfuse dataset per collection.
- Dataset experiments execute the real product path and materialize answer,
  retrieved contexts and tool trajectory.
- Every scored target turn is linked to its real product trace through the
  official Langfuse dataset-run-item API.
- Ragas RAG and agent/tool metrics publish only registered score names.
- Deterministic outcome and forbidden-context checks publish registered
  BOOLEAN scores.
- Langfuse experiments and annotation queues are used through official
  platform workflows; the repo does not maintain parallel manifests or queues.
- Trusted self-hosted Langfuse traces may contain user association, model I/O,
  memory and authorized retrieved facts. Credentials and secrets are forbidden.
- App-api and Operator Console keep a bounded projection and never copy
  Langfuse observation bodies.
- Langfuse availability never blocks online answers.

## Knowledge Agent Coverage

`campus/agent/routing` covers direct versus function-tool versus handoff
selection, target choice, conversation follow-up, mixed intent, closed sources,
stale context and prompt injection. `campus/rag/*` datasets cover history mode,
single- and cross-target search, search count, hard negatives, no-answer,
grounding and source integrity.

`tool_trajectory.v2` supplies public handoff and internal search facts.
`agent_runtime_eval_projection.v2` supplies answer, contexts, document ids and
resolved targets. Eval must not infer tool behavior from answer prose.

## Non-Goals

- Langfuse is not Temporal history, product storage or release authority.
- Ragas scores are not a custom repo release gate.
- App-api and Operator Console do not mirror Langfuse score/annotation state.
- The repo does not restore broad Python eval, custom retrieval scoring, custom
  experiment orchestration or private Ragas metrics.

## Acceptance

- `pnpm ci:eval` passes without external services.
- Dataset and score-config sync support dry-run.
- The unified dataset manifest discovers both `assets/datasets/agent/**` and
  `assets/datasets/rag/**` cases.
- Trace and dataset scoring reject missing identity, missing materialized RAG
  fields, secret-bearing payloads and unknown scores.
- Agent scoring uses official Ragas tool metrics over v2 trajectory data.
- Dataset run identity comes from Langfuse and remains internal lineage. Score
  API payloads carry exactly one observation or trace id and no dataset ids.

## References

- [Langfuse Architecture](../architecture/system/langfuse.md)
- [Langfuse Runtime](../contracts/langfuse-runtime.md)
- [Eval](../reference/eval.md)
- [Ragas Runbook](../runbooks/eval-ragas.md)
