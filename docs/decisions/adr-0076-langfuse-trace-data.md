---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0076
status: accepted
created: 2026-07-12
updated: 2026-07-12
supersedes:
  - adr-0069-raw-replay-capture
---
# ADR-0076 Langfuse Trace Data

## Context

The raw replay design duplicated capabilities already provided by the
self-hosted Langfuse trace, dataset and score platform. It introduced a custom
capture policy, replay packet schemas, fingerprints, object-store lifecycle and
product database columns without an active migration or compatibility need.

At the same time, treating all model input/output, memory and retrieved facts as
forbidden in Langfuse made the LLM observability system unable to show the real
execution it was deployed to inspect.

## Decision

Use self-hosted Langfuse as the trusted internal LLM observability plane.

- A sampled Agent SDK trace may include user/session association, model
  input/output, memory context and authorized retrieved facts.
- Credentials and secrets are forbidden in every trace and eval lane.
- App-api, Operator Console, Temporal metadata and PostgreSQL read models keep
  bounded projections and do not copy Langfuse observation bodies.
- Tracing is enabled at process startup through standard OTel exporter
  configuration. Requests do not carry an observability mode, sample ratio,
  exporter setting or sink reference.
- The custom raw-capture policy, replay packet/index/diff schemas, LLM I/O and
  answer fingerprints, replay services and database columns are retired.
- Badcase reproduction reruns a versioned Langfuse dataset item through the
  real product path.
- The eval adapter links the resulting product trace with the official
  dataset-run-item API and uses the returned dataset run identity for Ragas and
  deterministic scores.
- The adapter does not use `runExperiment` when a real product trace already
  exists, because that would create a second synthetic execution trace.

## Consequences

- The OpenAI Agents SDK instrumentation includes model I/O whenever request
  tracing is enabled.
- Product observability remains compact: correlation identity,
  model/provider identity, `agent_runtime_prompt_trace.v1` and stage timing.
- Score metadata remains scalar and allowlisted. Answer and context text belong
  in trace, dataset and Ragas sample fields.
- Langfuse availability does not block online execution. Temporal and
  PostgreSQL remain lifecycle truth.
- Ragas remains a narrow Python execution island using official metrics;
  TypeScript owns product execution, dataset linking and score publication.

## Alternatives Considered

### Keep the custom replay plane

Rejected. It duplicates trusted trace storage and adds custom lifecycle,
security, schema and operational work with no current compatibility consumer.

### Keep model I/O disabled in Langfuse

Rejected. Metadata-only spans cannot diagnose prompt, memory, retrieval or
model-output behavior.

### Use Langfuse `runExperiment` around the product call

Rejected for this runner. The product call already emits the canonical trace;
the official dataset-run-item link associates that trace with the dataset run
without synthesizing another execution.

## Relationship To Prior Decisions

ADR-0059 remains active for Langfuse platform ownership, but its
sanitized-trace-only wording is amended by this decision. ADR-0061 and ADR-0062
remain active for TypeScript ownership, the narrow Ragas Python island and safe
Ragas sample/score shapes.

## Related Documents

- `docs/contracts/langfuse-runtime.md`
- `docs/architecture/system/langfuse.md`
- `docs/reference/eval.md`
- `docs/runbooks/eval-ragas.md`
