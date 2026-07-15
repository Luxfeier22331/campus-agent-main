---
doc_type: contract
truth_scope: execution
owner_boundary: apps/execution-control
status: active
created: 2026-06-04
updated: 2026-07-13
---
# Durable Runtime

## Boundary

This document defines the stable durable execution projection consumed by
app-api, Operator Console and eval jobs.

Temporal workflow history is execution truth. PostgreSQL run, event, step,
attempt and result records are sanitized projections; they are not a second
queue, lease system or workflow engine.

The private HTTP wire is owned by
`docs/contracts/schemas/tool-execution.openapi.yaml`. The logical projection
schema is documented in `docs/data/durable-runtime.md`.

## Identifiers

- `conversation_id` identifies the product conversation owned by app-api.
- `turn_id` identifies one user turn.
- `request_id` correlates the app-api request ledger with execution.
- `run_id` identifies one durable answer execution.
- `step_id` identifies one sanitized workflow phase or projected internal
  operation within a run.
- `attempt_id` identifies one Temporal activity attempt projection.
- `trace_id` correlates approved observability sinks; it does not own
  lifecycle truth.

Identifiers are immutable after run creation. Nested execution payload identity
must match the run envelope.

## Run Lifecycle

Run status is one of:

- `created`
- `queued`
- `admitted`
- `running`
- `streaming`
- `completed`
- `failed`
- `canceled`
- `expired`

`completed`, `failed`, `canceled` and `expired` are terminal. A terminal
run cannot transition again, and late activity success cannot overwrite it.
Every terminal run carries a low-cardinality `terminal_reason`.

`streaming` means the execution produced streamable output; it does not mean
that a browser connection is still open.

## Workflow

`ToolExecutionWorkflow` dispatches exactly four ordered phases:

1. Memory Recall on the core activity queue.
1. One Agent Activity on the agent activity queue.
1. Finalization on the core activity queue.
1. Memory Append on the core activity queue.

The Agent Activity owns one complete OpenAI Agents SDK run. Primary Agent
decisions, official handoffs, Knowledge Agent execution and SDK function-tool
calls stay inside that activity.

There is no knowledge worker, specialist queue, typed-tool activity,
agent-as-tool activity, Go RAG graph or durable replan phase.

## Agent And Knowledge Projection

The Agent Activity may project only bounded facts such as:

- active and selected agent/tool identities;
- SDK handoff and function-tool summaries;
- provider/model-safe identity and input/output/cached token usage;
- terminal envelope and provider response reference;
- trace correlation and stage timing;
- `agent_runtime_prompt_trace.v1` prompt id and hashes.

`final_model_context.v2` contributes only count/character/truncation diagnostics
to durable projection. `truncation_summary.v2` never stores dropped content.
Model cost is derived in Langfuse rather than written as a PostgreSQL attempt
field.

`knowledge_query` is the model-visible handoff target. The Knowledge Agent's
only internal tool is `knowledge_search`. Each search call is admitted by
execution-control against the run-bound target/access context and may project a bounded
result reference, outcome and source identity.

Raw prompts, SDK state, tool arguments, vectors, Qdrant payloads, provider
responses and unrestricted snippets are not durable projection data.

## Finalization

Finalization validates the SDK terminal envelope and evidence closure. It does
not call a model or rewrite the answer.

For an evidence-backed answer, execution-control resolves every terminal
evidence reference against trusted `knowledge_search` results and creates
top-level `result.sources`. Forged, missing or conflicting evidence references
fail the run.

The final response may include:

- answer, status, follow-up and error fields;
- searched `resolved_targets[]`;
- selected tool and selected tool list;
- confirmed session updates;
- top-level trusted sources;
- workflow trace summary, stage timing and trace correlation;
- model/provider identity and `agent_runtime_prompt_trace.v1`.

App-api may normalize validated sources into browser source cards and safe
operator source summaries. It must not infer retrieval candidates, grounding
verdicts or quality scores from missing runtime data.

## Events And Steps

Run events are ordered by a monotonic sequence within one run. Step, attempt and
result projections attribute phase status, Temporal queue/worker identity,
retry, cancellation, timeout and fail-close outcomes.

The four workflow phases may be represented as steps. SDK-internal handoffs and
function calls may appear as sanitized summaries or child projections, but
must not create a second durable graph.

Event and result payloads contain bounded refs and summaries only. Browser,
operator and eval consumers read these projections or derived read models, not
Temporal history internals.

## Queue Contract

Canonical queues and WorkerDeployment roles are:

- the workflow task queue polled by `workflow-worker`;
- the core activity task queue polled by `activity-worker-core`;
- the agent activity task queue polled by `activity-worker-agent`.

PostgreSQL rows and process-local queues are not canonical dispatch truth.
Do not add knowledge, retrieval, tool or specialist task queues.

## Cancellation And Retry

Temporal owns activity retry, timeout, heartbeat and cancellation semantics.
Execution-control owns cancel admission and terminal projection.

- retry increments the Temporal/activity attempt projection;
- explicit cancellation terminates the run with `canceled`;
- timeout terminates with an approved timeout reason;
- late completion is recorded as ignored and cannot reopen the run;
- human-facing text cannot replace terminal or fail-close codes.

Agent runtime terminal errors preserve one of
`context_budget_exceeded`, `agent_deadline_exceeded`, `max_turns_exceeded`,
`provider_unavailable`, `tool_execution_failed` or `run_failed` in the bounded
failure projection.

## Data Safety

Durable projections must not contain:

- raw prompt, transcript or provider request/response;
- raw model or tool output payload;
- raw memory payload or vendor memory id;
- auth token, cookie, credential or broad identity snapshot;
- raw source body, vector record or object-store bytes;
- local filesystem path.

## Verification

Use the contract and Go lanes defined in
`docs/reference/testing-and-verification-lanes.md`:

```bash
pnpm contracts:generate
pnpm ci:contracts
pnpm go:check
```
