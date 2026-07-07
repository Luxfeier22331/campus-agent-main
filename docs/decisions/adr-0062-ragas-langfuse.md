---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0062
status: accepted
created: 2026-06-28
updated: 2026-06-28
supersedes:
  - adr-0061-eval-runtime
---
# ADR-0062: Ragas And Langfuse Collaboration

## Context

ADR-0059 accepted Langfuse as the LLM observability and eval platform. ADR-0061
then made TypeScript plus Langfuse the default eval runtime path, while keeping
RAGAS isolated in `packages/ragas-runner`.

The original RAGAS boundary was too artifact-only. It required RAGAS scoring to
start from repo-owned sanitized sample artifacts and stated that Langfuse traces
were not a source of answer, retrieval context or reference text. That protected
the telemetry boundary, but it prevented the standard Langfuse + Ragas workflow:
sample Langfuse traces or datasets, run Ragas, and write scores back to
Langfuse.

Official guidance from both projects supports that workflow:

- Langfuse RAGAS cookbook: <https://langfuse.com/guides/cookbook/evaluation_of_rag_with_ragas>
- Langfuse external evaluation pipelines:
  <https://langfuse.com/guides/cookbook/example_external_evaluation_pipelines>
- Ragas Langfuse integration:
  <https://docs.ragas.io/en/stable/howtos/integrations/_langfuse/>

## Decision

Use the official collaboration shape as the target RAG evaluation path:

`Langfuse traces / datasets -> Ragas evaluation -> Langfuse scores`

Langfuse may provide Ragas input only through a repo-owned safe eval projection.
This projection may include:

- trace, observation, dataset item and case identity
- user input or question when it is approved for eval storage
- model response or answer when it is approved for eval storage
- retrieved context ids and reference context ids
- eval-safe retrieved context excerpts or reference excerpts
- surface, variant, release and metric applicability metadata

The projection must not include secrets, auth material, provider raw response,
raw prompt, raw transcript, unrestricted source body, object-store paths or
retrieval backend dumps.

`ragas_sample_batch.v1` remains accepted as an offline / CI artifact path. It is
no longer the only target source for RAGAS scoring.

## Consequences

- `packages/eval-langfuse` owns Langfuse dataset / trace selection, safe
  projection construction, score publishing and dataset manifest construction.
- `packages/ragas-runner` remains a narrow Python island for upstream Ragas
  scoring. It does not own case truth, trace selection, provider projection,
  Langfuse publishing, release gates or long-lived orchestration.
- Golden qrels and reviewed cases remain repo-owned truth. When possible, qrels
  should project into `reference_context_ids` and runtime retrieval should
  project into `retrieved_context_ids` so Ragas ID-based context metrics can be
  used before adding a separate IR metric runner.
- Langfuse scores are allowed to carry trace or observation correlation when
  that correlation comes from safe projection. Operator-facing views use the
  minimal app-api Ops Index and safe sink links rather than querying Langfuse
  directly or storing app-api-owned runtime/quality score projections; the old
  eval backlink projection is retired.
- The raw payload ban remains active. This ADR narrows the ban to raw and
  unrestricted payloads; it does not prohibit safe RAG eval projection fields.

## Relationship To Prior ADRs

ADR-0059 remains active: Langfuse is still not execution runtime, product
storage, operator query backend or repo contract owner.

ADR-0061 remains active for eval runtime ownership, old `packages/evals`
retirement and the `packages/ragas-runner` Python-island boundary. This ADR
supersedes only the artifact-only RAGAS input assumption in ADR-0061.
