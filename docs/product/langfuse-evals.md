---
doc_type: product_requirement
truth_scope: product
owner_boundary: docs/product
status: active
created: 2026-06-19
updated: 2026-07-05
---

# Langfuse Evals

## 1. Background

Langfuse is the LLM observability and eval platform for campus-agent. It can
hold traces, datasets, experiments, annotation workflows, scores and score
analytics. It does not replace repo-owned versioned eval asset truth, Temporal history,
app-api projection, operator backend contracts or release authority.

Eval migration is Langfuse/Ragas-first. The active product requirement is to
let engineering, Eval / QA and operator workflows inspect the same sanitized
eval evidence while avoiding repo-owned self-built eval frameworks.

## 2. Goals

- Langfuse can correlate request / run / workflow / eval identity.
- Langfuse can store `ragas.*` scores published from repo-owned safe
  projections.
- Agent tool-use cases can be stored as Langfuse datasets / experiments for
  routing, tool selection, source quality and fail-closed review. Public web
  search is the first tool-specific slice.
- Langfuse datasets can be synced from repo RAG eval assets without fabricating
  answers or retrieved contexts.
- Langfuse experiments and annotation queues can be used as official platform
  workflows without repo-owned experiment or review-manifest automation.
- Operator-facing surfaces consume only app-api sanitized projections and safe
  runtime quality candidates; they do not query Langfuse directly.
- Default Langfuse-bound safe payloads obey the forbidden-field policy.
- Restricted replay-backed eval can use `llm_replay_packet.v1` only after
  request-scoped `raw_capture_policy.v1` admission.

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
  to default safe eval datasets, score metadata or operator-safe projections.
- Do not treat restricted replay-backed eval as ordinary production dataset
  sync, training data, Operator Console payload or release verdict truth.

## 4. Users And Scenarios

- Engineering: inspect trace, observation and score evidence for a real request
  or materialized dataset run.
- Eval / QA: compare RAG quality across datasets, releases and model/prompt
  variants.
- Operator: review runtime quality candidates and safe trace links without
  directly depending on Langfuse as a backend.
- Product / architecture: understand quality trend, regression risk and
  release-closeout boundaries.

## 5. Product Requirements

### 5.1 Trace And Dataset Scoring

- `ragas-score-traces` selects Langfuse traces by name, tag, release and limit.
- `ragas-score-dataset` scores only materialized Langfuse dataset items.
- Qrels-only dataset items carry `reference_context_ids`; they must be paired
  with safe trace/observation projection before Ragas scoring.
- Missing trace identity, missing answer, missing retrieved contexts,
  denominator drift or forbidden payloads must fail closed.
- Restricted replay-backed scoring must reference `llm_replay_packet.v1` by
  packet metadata and policy identity. It must not copy raw packet bodies into
  score metadata or app-api projections.

### 5.2 Score Registry And Publishing

- Active score names are the names registered in
  `packages/eval-langfuse/assets/registries/langfuse_score_registry.v1.json`.
  Current families include `ragas.*`, `agent.*` and tool-specific scores such
  as `public_web_search.*`.
- Every published score must exist in
  `packages/eval-langfuse/assets/registries/langfuse_score_registry.v1.json`.
- Unknown score names, invalid target identity or forbidden metadata must fail
  closed.
- Score publication targets Langfuse scores, not repo-owned release verdict
  artifacts.

### 5.3 Dataset Sync

- Repo RAG eval assets remain the source for Langfuse-bound qrels,
  answer-quality and known-gap cases.
- Dataset sync must preserve source asset path, case id, source git head and
  asset hash.
- Dataset sync must not invent generated answers or retrieved context text for
  qrels-only cases.

### 5.4 Annotation And Review

- Langfuse annotation queues remain the official human review workflow.
- Reviewer output can inform backlog or asset candidates, but cannot directly
  overwrite canonical versioned eval asset truth or release verdicts.
- The repo no longer owns custom annotation queue sync/export commands.

### 5.5 Operator-Safe Projection

- Operator Console does not directly query Langfuse.
- App-api does not expose runtime quality badcases, negative feedback candidates,
  Langfuse score state or trace backlink queues through the current Operator
  Console surface.
- App-api may expose only request-level safe correlation fields owned by the Ops
  Index contract.
- The retired eval coverage / diagnostic-badcase / Langfuse backlink projection
  paths must not be restored as product requirements.

### 5.6 Public Web Search Agent Eval

- Public-web-search eval is the first `agent-tool-use` slice: routing/tool
  selection, source quality and grounded answer review.
- Its repo eval asset lives under
  `packages/eval-langfuse/assets/datasets/agent/public_web_search/`.
- Asset validation is owned by `packages/eval-langfuse`:
  `pnpm --dir packages/eval-langfuse langfuse validate-public-web-search-eval`.
- Tool-use scoring consumes `tool_trajectory.v1`; it must not infer routing
  from raw prompt, provider response or final answer prose.
- It must not be scored through RAGAS unless a dedicated case explicitly evaluates
  RAG answer synthesis over materialized retrieval contexts. The public web
  typed tool readiness smoke is not an eval run.
- Default provider selection for this tool is governed by the public-web-search
  provider bakeoff rules in [Eval Reference](../reference/eval.md), not by this
  product requirement document.

## 6. Data Boundary

Allowed in safe eval projection:

- trace, observation, dataset item and case identity
- question or user input approved for eval storage
- answer approved for eval storage
- retrieved contexts and optional retrieved/reference context ids
- surface, variant, release and metric applicability metadata

Allowed only in restricted replay-backed eval:

- raw or near-raw rendered messages
- provider request / response bodies
- provider stream deltas
- selected evidence packet text
- selected memory context text
- tool call / tool result payloads

These fields require `raw_capture_policy.v1`, encrypted object storage, TTL,
RBAC, access audit and deletion linkage as defined by
`docs/contracts/replay-capture.md`.

Forbidden:

- raw prompt, raw transcript, raw provider response
- unrestricted source body, object-store path, retrieval backend dump
- JWT, cookie, authorization header, API key, provider secret or database URL

The forbidden list above applies to safe eval projection, safe datasets, score
metadata and Operator-facing projection. Restricted replay artifacts have their
own narrower contract and never allow secrets or auth material.

## 7. Acceptance

- `ragas-score-traces --validate-only` builds safe samples from Langfuse traces
  and validates score payloads.
- `ragas-score-dataset --validate-only` fails closed for qrels-only dataset
  items and succeeds for materialized dataset items.
- `sync-score-configs --dry-run` covers all active registered scores.
- `sync-datasets --dry-run` reports dataset changes without writing platform
  state.
- `verify-trace` distinguishes repo-owned observations from SDK /
  infrastructure observations and rejects forbidden payload fields.
- Restricted replay-backed eval validates packet TTL, policy mode,
  allowed_raw_fields, RBAC/audit requirements and deletion linkage before
  consuming a packet.
- `validate-public-web-search-eval` validates public web search agent cases,
  expected tool labels and public HTTPS MUC URL constraints.

## 8. References

- [ADR-0059 Langfuse Observability And Eval Platform](../decisions/adr-0059-langfuse-observability-and-eval-platform.md)
- [ADR-0061 Eval Runtime](../decisions/adr-0061-eval-runtime.md)
- [ADR-0062 Ragas And Langfuse Collaboration](../decisions/adr-0062-ragas-langfuse.md)
- [ADR-0069 Raw Replay Capture](../decisions/adr-0069-raw-replay-capture.md)
- [Langfuse Architecture](../architecture/system/langfuse.md)
- [Langfuse Runtime Contract](../contracts/langfuse-runtime.md)
- [Replay Capture Contract](../contracts/replay-capture.md)
- [Tool Trajectory Contract](../contracts/tool-trajectory.md)
- [Eval Reference](../reference/eval.md)
- [Eval Map](../reference/eval-map.md)
- [Eval Ragas Runbook](../runbooks/eval-ragas.md)
