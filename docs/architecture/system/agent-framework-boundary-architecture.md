---
doc_type: architecture
truth_scope: execution
owner_boundary: agent-runtime
status: active
created: 2026-06-13
updated: 2026-06-13
---
# Agent Framework Boundary Architecture

## Document Boundary

This document owns the supporting architecture for model-facing agent framework
usage, including OpenAI Agents SDK participation through `apps/agent-runtime`.

It does not own:

- durable execution truth
- surface admission or product auth
- source truth, tool opening posture or capability readiness
- panel/eval canonical projection
- RAG-family retrieval internals

## Core Boundary

Agent frameworks are implementation substrate for model-facing loops. They are
not repo-level orchestration owners.

`apps/agent-runtime` may use OpenAI Agents SDK for:

- primary agent instructions
- strict function tool schemas derived from repo-owned artifacts
- model-facing tool loop execution
- direct/no-tool final output
- selected tool summary
- SDK trace reference normalization
- usage summary normalization

It must not own run truth, Temporal lifecycle, source truth, product auth,
surface policy, tool opening posture, finalization or panel/eval canonical
projection.

## Admission Order

Online model-facing execution follows this order:

1. `app-api` performs product-surface and account/session admission.
1. `execution-control` admits the durable run and trims visible capabilities /
   tools.
1. Temporal starts an admitted activity for primary agent or capability worker.
1. The SDK loop receives only the workflow-trimmed tool subset.
1. Tool calls go through repo-owned internal query services or workflow signals.
1. SDK output is normalized into sanitized result refs and usage summary.
1. Go finalization writes the terminal projection.

The SDK must not receive the global tool list. It only receives tools admitted
for the current run / step.

## Tool And Trace Semantics

Provider-native function calling and SDK tool loops may improve ergonomics, but
their schemas must be generated from or checked against repo-owned tool
artifacts.

SDK trace, run state, raw prompts, raw model output, provider tool payloads and
handoff graphs are debug inputs. Before anything reaches `app-api`, panel, eval
or workflow summaries, it must be reduced to repo-owned bounded projection.

## Failure Semantics

Missing provider config, model config, API key, SDK dependency, agent runtime
config, empty final output or non-completed SDK status must fail closed.

`agent-runtime` errors project as bounded `agent.primary` diagnostics. They must
not be rewritten as typed tool fail-close reasons unless the failing operation
was an admitted tool call with a typed outcome.

Internal query fetch failures may be normalized into typed transient outcomes
only when they happen inside an admitted tool call.

## Not In Default Scope

The following are not default campus answer-path tools:

- hosted web search
- file search
- code interpreter
- remote MCP
- shell or filesystem tools
- raw SQL, object store, OCR dump, collector runtime or ingestion write tools
- SDK-native session memory as product conversation truth
- state-changing tools such as appointment, submission, payment or ticket
  creation

## Related Documents

- `execution-agent-layer-architecture.md`
- `tool-and-capability-runtime-architecture.md`
- `prompt-and-instruction-architecture.md`
- `durable-agent-runtime-architecture.md`
