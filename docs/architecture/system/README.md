---
doc_type: index
truth_scope: execution
owner_boundary: docs
status: active
created: 2026-04-23
updated: 2026-06-13
---
# System Architecture

`system/` owns cross-domain supporting architecture. It explains repo-wide
runtime, routing, execution, retrieval, data-plane and observability boundaries.

It does not own phase status, release closeout, source-channel schemas or
capability-local readiness.

## Question Routing

- Product surfaces, browser shells and shared app-api runtime:
  - `product-runtime-architecture.md`
- Main answer chain and Execution Agent Layer ownership:
  - `execution-agent-layer-architecture.md`
- Capability routing, surface admission and visible tool set:
  - `capability-routing-and-admission-architecture.md`
- Typed tool, deterministic query function and agent-as-tool runtime:
  - `tool-and-capability-runtime-architecture.md`
- Agent framework / OpenAI Agents SDK boundary:
  - `agent-framework-boundary-architecture.md`
- Historical execution/agents compatibility route:
  - `execution-and-agents-architecture.md`
- Temporal, durable run/event/step projection, cancel, timeout and resume:
  - `durable-agent-runtime-architecture.md`
- Prompt, system instruction and provider-facing prompt ownership:
  - `prompt-and-instruction-architecture.md`
  - `prompt-and-instruction/current-runtime-baseline.md`
  - `prompt-and-instruction/assembly-and-assets.md`
  - `prompt-and-instruction/safety-observability-and-rollout.md`
- Personal memory recall and memory lifecycle:
  - `memory-plane-architecture.md`
- Retrieval serving and RAG-family internal planning:
  - `retrieval-serving-architecture.md`
  - `agentic-retrieval-architecture.md`
- Data-plane owner boundaries:
  - `data-plane-architecture.md`
- Operator/eval/badcase/release diagnostic projection:
  - `operator-observability-architecture.md`
- Code organization, decomposition and package ownership:
  - `code-organization-and-decomposition-architecture.md`
- Runtime delivery, readiness and release hardening architecture:
  - `runtime-delivery-and-release-hardening-architecture.md`
- Document site and file asset architecture:
  - `document-site-architecture.md`
  - `file-asset-loader-architecture.md`
- Identity, authorization and account boundary:
  - `identity-and-authorization-architecture.md`
- Retired or offline Python capability boundary:
  - `python-capability-boundaries.md`

## Legacy Route

`execution-and-agents-architecture.md` remains as a compatibility route for
historical links. It does not own body truth for Execution Agent Layer, agent
framework, tool / capability or RAG internals after the Phase 4 split.

## Use Rules

- This directory owns cross-domain supporting truth only.
- Domain-level source-channel details belong in `../domains/`.
- Contract and schema details belong in `../../contracts/` or `../../data/`.
- Staging/release proof and operational procedure belong in `../../runbooks/`,
  `../../environment/` or `../../policies/`.
- Workstream state and backlog signals belong in `.planning/`.
