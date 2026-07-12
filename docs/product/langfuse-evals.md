---
doc_type: product_requirement
truth_scope: product
owner_boundary: docs/product
status: active
created: 2026-06-19
updated: 2026-07-11
---
# Langfuse Evals

## Background

Langfuse is the shared platform for traces, datasets, experiments, annotation
workflows and scores. It does not replace repo-owned eval assets, Temporal
history, app-api storage, contracts or release authority.

## Goals

- Correlate request, run, workflow, trace and eval identity.
- Score approved Langfuse traces and materialized datasets with upstream Ragas.
- Evaluate primary-agent tool and handoff decisions with deterministic TS
  scorers over `tool_trajectory.v1`.
- Publish only registered scores and bounded metadata.
- Use Langfuse annotation and experiment workflows instead of rebuilding them
  in the repo.
- Keep Operator-facing surfaces on sanitized repo projections.

## Non-Goals

- Do not restore `packages/evals`, Python `campus_evals` or broad self-built eval
  frameworks.
- Do not make online serving depend on Langfuse.
- Do not expose Langfuse SDK/API types through shared contracts.
- Do not build an Operator Console trace viewer or copy Langfuse trace bodies
  into app-api.
- Do not capture or retain raw production model I/O for replay.

## Product Requirements

### Trace And Dataset Scoring

- `ragas-score-traces` selects traces by explicit name, tag, release and limit.
- `ragas-score-dataset` scores only materialized dataset items.
- Qrels-only items must be paired with approved answer/context material before
  scoring.
- Missing identity, answer, contexts, metric denominator or allowed fields must
  fail closed.

### Score Publishing

- Every score name must exist in
  `packages/eval-langfuse/assets/registries/langfuse_score_registry.v1.json`.
- Current score families include `ragas.*` and `agent.*`.
- Scores target Langfuse observations, traces or dataset runs; they are not
  repo-owned release verdicts.

### Dataset And Review

- Repo eval assets remain the source for repo-authored qrels and known cases.
- Dataset sync preserves source path, case id, source git head and asset hash.
- Dataset sync must not fabricate generated answers or retrieved contexts.
- Langfuse annotation queues are the human-review workflow. Reviewer output may
  propose repo asset changes but cannot overwrite them directly.

### Operator Boundary

- Operator Console does not query Langfuse.
- App-api exposes only request-level safe correlation and runtime status owned
  by the Ops Index contract.
- Eval coverage, diagnostic badcase and external sink projections require a new
  explicit product contract before entering Operator Console.

## Data Boundary

Approved eval projection may include case and trace identity, approved
question/answer text, retrieved/reference contexts or ids, tool trajectory
facts, release metadata and metric applicability.

Raw prompts, transcripts, provider payloads, unrestricted source bodies,
memory text, auth material, secrets, database URLs and object-store paths are
forbidden.

## Acceptance

- Trace and dataset commands support validation without publishing scores.
- Score-config and dataset sync support dry-run.
- Trace verification rejects missing correlation and forbidden payload fields.
- Agent tool-use validation covers all currently model-visible tools and the
  Knowledge Agent handoff.
- Published scores are queryable from the expected Langfuse target.

## References

- [Langfuse Architecture](../architecture/system/langfuse.md)
- [Langfuse Runtime Contract](../contracts/langfuse-runtime.md)
- [Tool Trajectory Contract](../contracts/tool-trajectory.md)
- [Eval Reference](../reference/eval.md)
- [Eval Map](../reference/eval-map.md)
- [Eval Ragas Runbook](../runbooks/eval-ragas.md)
- [ADR-0059](../decisions/adr-0059-langfuse-observability-and-eval-platform.md)
- [ADR-0061](../decisions/adr-0061-eval-runtime.md)
- [ADR-0062](../decisions/adr-0062-ragas-langfuse.md)
