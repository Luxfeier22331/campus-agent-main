---
doc_type: architecture
truth_scope: execution
owner_boundary: execution-control
status: active
created: 2026-06-04
updated: 2026-07-11
---
# Durable Agent Runtime Architecture

## Boundary

This document owns the durable online answer lifecycle. Temporal owns workflow
history, task queues, retries, timers and activity dispatch. Execution-control
owns admission and sanitized product projection. OpenAI Agents SDK owns the
agent/tool loop inside one Agent Activity.

## Canonical Objects

- `Conversation` and `Turn` belong to app-api product truth.
- `Run` is the product-visible durable execution object.
- `ToolExecutionWorkflow` is the Temporal workflow for one run.
- `RunEvent`, `RunStep`, `StepAttempt` and `StepResult` are sanitized
  projections, not workflow history.
- `Finalization` is the validated terminal projection consumed by app-api.

PostgreSQL stores projection truth for product reads, Operator Console and
eval. It is not the execution queue or raw Temporal history store.

## Four Phases

The workflow order is fixed:

1. **Memory Recall** on the core activity queue prepares optional bounded
   personal-memory context.
1. **Agent Activity** on the agent queue invokes `apps/agent-runtime` once. The
   complete OpenAI Agents SDK run includes primary-agent reasoning, SDK
   function tools, official handoff to the Knowledge Agent, internal
   `knowledge_search` calls and structured terminal output.
1. **Finalization** on the core queue validates terminal output and evidence,
   generates sources and writes the final projection.
1. **Memory Append** on the core queue submits the bounded post-answer memory
   update.

The SDK run is not split into Temporal activities for tool calls, handoffs,
retrieval, synthesis or grounding. There is no workflow replan state.

## Worker Pools

Only these worker pools belong to the online execution plane:

- `workflow-worker` polls the workflow task queue;
- `activity-worker-core` polls the core activity queue;
- `activity-worker-agent` polls the agent activity queue.

There is no knowledge, tool, retrieval or specialist worker/queue. KEDA/HPA may
scale the three pools without owning workflow state or product projection.

## Agent Activity

Execution-control supplies run identity, admitted visible tools, allowed
knowledge scopes, provider config and bounded memory context. Agent-runtime
returns structured terminal output, sanitized SDK tool-call summaries, usage
and safe trace references.

SDK `maxTurns` bounds the run's agent/tool turns. It is not a retry count,
replanning budget or additional durable phase.

Internal SDK tools use authenticated execution-control query endpoints while
the Agent Activity is running. Their calls may produce sanitized diagnostic
projection, but they remain inside the Agent Activity lifecycle.

## Cancellation And Timeout

Temporal cancellation and activity deadlines must propagate to agent-runtime
and all in-flight provider/internal-query calls. Terminal projection must
distinguish cancellation, timeout, fail-close and late completion. A late
success cannot overwrite an already terminal run.

Provider calls expose bounded latency, usage, cost and abort outcome when those
facts are available. Missing abort proof must not be represented as confirmed
provider cancellation.

## Finalization

Finalization is deterministic validation and projection:

- validate terminal schema and allowed outcome;
- validate evidence references against admitted `knowledge_search` results;
- derive browser-safe source items from trusted evidence metadata;
- reject missing, forged or cross-scope evidence;
- write final answer, sources, usage and terminal reason.

Finalization does not invoke an LLM, synthesize a second answer or paraphrase
the SDK answer. App-api does not rewrite the finalized answer.

## Streaming

Browser streaming is a subscription to sanitized run events. HTTP connection
lifetime does not own execution lifetime. Reconnect reads the durable event
projection and current run state; it does not start a fallback execution.

## Admission And Capacity

Execution-control admits new runs against runtime readiness, policy and
downstream budgets. Process-local limits are protection only. Temporal task
queues and the worker autoscaling posture define deploy-level capacity.

Missing Temporal, projection, provider, internal query, scope registry or
evidence truth fails closed. Redis and PostgreSQL rows do not replace Temporal
queue truth.

## Forbidden Shapes

- one Temporal activity or queue per SDK tool/specialist
- a separate Knowledge Agent worker
- deterministic workflow code that selects semantic tools
- a fixed retrieval/synthesis/grounding activity graph
- durable replanning state derived from SDK turns
- app-api or finalization answer rewriting
- fallback from indexed knowledge to live public web search

## Related Documents

- `execution-agent-layer.md`
- `agent-framework.md`
- `k8s-runtime.md`
- `../../contracts/durable-runtime.md`
- `../../data/durable-runtime.md`
