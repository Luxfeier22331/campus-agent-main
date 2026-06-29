---
doc_type: product_requirement
truth_scope: product
owner_boundary: docs/product
status: active
created: 2026-06-19
updated: 2026-06-29
---

# Langfuse Evals

## 1. Background

Langfuse is the LLM observability and eval platform for campus-agent. It can
hold traces, datasets, experiments, annotation workflows, scores and score
analytics. It does not replace repo-owned fixture truth, Temporal history,
app-api projection, operator backend contracts or release authority.

Eval migration is Langfuse/Ragas-first. The active product requirement is to
let engineering, Eval / QA and operator workflows inspect the same sanitized
eval evidence while avoiding repo-owned self-built eval frameworks.

## 2. Goals

- Langfuse can correlate request / run / workflow / eval identity.
- Langfuse can store `ragas.*` scores published from repo-owned safe
  projections.
- Langfuse datasets can be synced from repo RAG fixtures without fabricating
  answers or retrieved contexts.
- Langfuse experiments and annotation queues can be used as official platform
  workflows without repo-owned experiment or review-manifest automation.
- Operator-facing surfaces consume only app-api sanitized projections and safe
  runtime quality candidates; they do not query Langfuse directly.
- Langfuse-bound payloads obey the forbidden-field policy.

## 3. Non-Goals

- Do not restore `packages/evals`, Python `campus_evals`,
  `scripts.eval_gate`, broad `agent-eval`, `rag-first-stage` or `ragas-batch`
  as active product/eval paths.
- Do not use Langfuse as Temporal workflow history, app-api product storage,
  operator query truth or repo contract truth.
- Do not let online answer serving depend on Langfuse availability.
- Do not leak Langfuse SDK/API types into `packages/contracts`.
- Do not send raw prompts, raw answers, transcripts, retrieved snippets,
  unrestricted source bodies, provider raw responses, auth material or secrets
  to Langfuse.

## 4. Users And Scenarios

- Engineering: inspect trace, observation and score evidence for a real request
  or materialized dataset run.
- Eval / QA: compare RAG quality across datasets, releases and model/prompt
  variants.
- Operator: review runtime quality candidates and safe trace links without
  directly depending on Langfuse as a backend.
- Product / architecture: understand quality trend, regression risk and
  release evidence boundaries.

## 5. Product Requirements

### 5.1 Trace And Dataset Scoring

- `ragas-score-traces` selects Langfuse traces by name, tag, release and limit.
- `ragas-score-dataset` scores only materialized Langfuse dataset items.
- Qrels-only dataset items carry `reference_context_ids`; they must be paired
  with safe trace/observation projection before Ragas scoring.
- Missing trace identity, missing answer, missing retrieved contexts,
  denominator drift or forbidden payloads must fail closed.

### 5.2 Score Registry And Publishing

- Active score names are `ragas.*`.
- Every published score must exist in
  `packages/eval-langfuse/fixtures/ops/langfuse_score_registry.v1.json`.
- Unknown score names, invalid target identity or forbidden metadata must fail
  closed.
- Score publication targets Langfuse scores, not repo-owned release verdict
  artifacts.

### 5.3 Dataset Sync

- Repo RAG fixtures remain the source for Langfuse-bound qrels,
  answer-quality and known-gap cases.
- Dataset sync must preserve source fixture path, case id, source git head and
  fixture hash.
- Dataset sync must not invent generated answers or retrieved context text for
  qrels-only cases.

### 5.4 Annotation And Review

- Langfuse annotation queues remain the official human review workflow.
- Reviewer output can inform backlog or fixture candidates, but cannot directly
  overwrite canonical fixture truth or release verdicts.
- The repo no longer owns custom annotation queue sync/export commands.

### 5.5 Operator-Safe Projection

- Operator Console does not directly query Langfuse.
- App-api may expose runtime quality badcases, negative feedback candidates and
  safe trace links through owned contracts.
- The retired eval coverage / diagnostic-badcase / Langfuse backlink projection
  paths must not be restored as product requirements.

## 6. Data Boundary

Allowed in safe eval projection:

- trace, observation, dataset item and case identity
- question or user input approved for eval storage
- answer approved for eval storage
- retrieved contexts and optional retrieved/reference context ids
- surface, variant, release and metric applicability metadata

Forbidden:

- raw prompt, raw transcript, raw provider response
- unrestricted source body, object-store path, retrieval backend dump
- JWT, cookie, authorization header, API key, provider secret or database URL

## 7. Acceptance

- `ragas-score-traces --validate-only` builds safe samples from Langfuse traces
  and validates score payloads.
- `ragas-score-dataset --validate-only` fails closed for qrels-only dataset
  items and succeeds for materialized dataset items.
- `sync-score-configs --dry-run` covers all active `ragas.*` scores.
- `sync-datasets --dry-run` reports dataset changes without writing platform
  state.
- `verify-trace` distinguishes repo-owned observations from SDK /
  infrastructure observations and rejects forbidden payload fields.

## 8. References

- [ADR-0059 Langfuse Observability And Eval Platform](../decisions/adr-0059-langfuse-observability-and-eval-platform.md)
- [ADR-0061 Eval Runtime](../decisions/adr-0061-eval-runtime.md)
- [ADR-0062 Ragas And Langfuse Collaboration](../decisions/adr-0062-ragas-langfuse.md)
- [Langfuse Architecture](../architecture/system/langfuse.md)
- [Langfuse Runtime Contract](../contracts/langfuse-runtime.md)
- [Eval Reference](../reference/eval.md)
- [Eval Map](../reference/eval-map.md)
- [Eval Ragas Runbook](../runbooks/eval-ragas.md)
