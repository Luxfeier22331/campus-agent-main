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
tool-local readiness.

## Question Routing

- Product surfaces, browser shells and shared app-api runtime:
  - `product-runtime-architecture.md`
- Main answer chain and Execution Agent Layer ownership:
  - `execution-agent-layer-architecture.md`
- Tool routing, surface admission and visible tool set:
  - `tool-routing.md`
- Typed tool, deterministic query function and agent-as-tool runtime:
  - `tool-runtime.md`
- Agent framework / OpenAI Agents SDK boundary:
  - `agent-framework.md`
- Temporal, durable run/event/step projection, cancel, timeout and resume:
  - `durable-agent-runtime-architecture.md`
- Kubernetes execution-control substrate and KEDA/HPA worker autoscaling target:
  - `k8s-runtime.md`
- Prompt, system instruction and provider-facing prompt ownership:
  - `prompt.md`
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
  - `ops-observability.md`
- Langfuse LLM observability / eval platform boundary:
  - `langfuse-observability-and-eval-architecture.md`
- Code organization, decomposition and package ownership:
  - `code-organization.md`
- Runtime delivery, readiness and release hardening architecture:
  - `runtime-release.md`
- Document site and file asset architecture:
  - `document-site-architecture.md`
  - `file-asset-loader-architecture.md`
- Identity, authorization and account boundary:
  - `identity-and-authorization-architecture.md`
  - `identity-platform-architecture.md`
  - `identity-browser-experience-architecture.md`
  - `federation-and-mucwiki-login-architecture.md`
- Operator Console operations domain and current implementation boundary:
  - `operator-console-operations-architecture.md`
- Retired or offline Python boundary:
  - `python-boundaries.md`

## Use Rules

- This directory owns cross-domain supporting truth only.
- Domain-level source-channel details belong in `../domains/`.
- Contract and schema details belong in `../../contracts/` or `../../data/`.
- Staging/release proof and operational procedure belong in `../../runbooks/`,
  `../../environment/` or `../../policies/`.
- Workstream state and backlog signals belong in `.planning/`.
