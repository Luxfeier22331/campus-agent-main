---
doc_type: reference
truth_scope: eval
owner_boundary: packages/eval-langfuse
status: active
created: 2026-06-28
updated: 2026-07-11
---
# Eval

## Active Shape

Repo-owned eval is Langfuse/Ragas-first:

- `packages/eval-langfuse` owns Langfuse adapters, safe Ragas projection,
  deterministic agent scorers, score publication and trace verification.
- `packages/ragas-runner` is the only accepted Python island and runs upstream
  Ragas over safe JSON input produced by TypeScript.
- `packages/eval-langfuse/assets` stores repo-authored eval assets and score
  registries.
- `jobs/learning-loop-candidates` selects safe feedback and latency candidates
  and may publish them to Langfuse datasets.

The scoring loop is:

```text
Langfuse traces / materialized datasets
-> packages/eval-langfuse safe projection
-> packages/ragas-runner upstream Ragas or deterministic TS scorer
-> packages/eval-langfuse Langfuse scores
```

## Active Lanes

Workflow-dispatchable lanes are listed in `docs/reference/eval-map.md`:

- `ragas-trace`
- `ragas-dataset`
- `agent-tool-use`

`ragas-trace` and `ragas-dataset` score approved question, answer and context
material. `agent-tool-use` consumes `tool_trajectory.v1` and evaluates direct
answer, fail-closed, `transport_schedule_lookup` and `knowledge_query` handoff
behavior.

## Data Boundary

Safe Ragas projection may include trace/dataset identity, approved question and
answer text, retrieved/reference contexts or ids and metric applicability.

Forbidden fields include raw prompts, transcripts, provider payloads,
unrestricted source bodies, raw memory text, auth material, secrets, database
URLs, object-store paths and retrieval backend dumps. There is no production raw
model-I/O replay lane.

## Active Scores

The default Ragas metrics are:

- `ragas.faithfulness`
- `ragas.answer_relevancy`
- `ragas.context_precision`
- `ragas.context_recall`

Optional metrics are enabled only through Ragas runtime config. Deterministic
agent scores include `agent.tool_selection.correct` and other registered
`agent.*` contract checks.

Every score must exist in
`packages/eval-langfuse/assets/registries/langfuse_score_registry.v1.json`.
Unknown score names fail closed.

## Asset Semantics

Repo-tracked public assets are synthetic examples for schema, qrels and
safe-projection coverage. They are not the private release gold corpus. Real
release denominators come from approved private assets, materialized Langfuse
datasets or sanitized runtime trace projection.

## Operator Boundary

Langfuse owns dataset/run/score state. App-api and Operator Console do not
recreate eval coverage, low-score candidate or sink mirror stores. Eval
results can inform changes, but release authority remains with the owning
product/runtime validation.

## Related Documents

- `docs/reference/eval-map.md`
- `docs/product/langfuse-evals.md`
- `docs/architecture/system/learning-loop.md`
- `docs/contracts/langfuse-runtime.md`
- `docs/contracts/tool-trajectory.md`
