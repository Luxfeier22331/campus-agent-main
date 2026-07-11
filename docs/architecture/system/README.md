---
doc_type: index
truth_scope: execution
owner_boundary: docs/architecture/system
status: active
created: 2026-04-23
updated: 2026-07-08
---
# System Architecture

`system/` owns cross-domain supporting architecture. It explains repo-wide
runtime, routing, execution, retrieval, data-plane and observability boundaries.
Stable cross-boundary diagrams are indexed in `../flows.md`.

It does not own phase status, release closeout, source-channel schemas or
tool-local readiness.

## Question Routing

- Product surfaces, browser shells and shared app-api runtime:
  - `product-runtime.md`
- Main answer chain and Execution Agent Layer ownership:
  - `execution-agent-layer.md`
- Tool routing, surface admission and visible tool set:
  - `tool-routing.md`
- SDK function-tool and internal-query runtime:
  - `tool-runtime.md`
- Agent framework / OpenAI Agents SDK boundary:
  - `agent-framework.md`
- Temporal, durable run/event/step projection, cancel, timeout and resume:
  - `durable-runtime.md`
- Kubernetes execution-control substrate and KEDA/HPA worker autoscaling target:
  - `k8s-runtime.md`
- Runtime config, GitOps and secret delivery decisions:
  - `../../decisions/adr-0064-runtime-config-governance.md`
  - `../../decisions/adr-0065-gitops-argocd-helm-boundary.md`
  - `../../decisions/adr-0066-secret-delivery.md`
- Prompt, system instruction and provider-facing prompt ownership:
  - `prompt.md`
- Personal memory recall and memory lifecycle:
  - `memory-plane.md`
- Knowledge Agent and indexed retrieval serving:
  - `retrieval-serving.md`
  - `agentic-retrieval.md`
- Data-plane owner boundaries:
  - `data-plane.md`
- Worker operator summaries and self-hosted runtime diagnosis:
  - `ops-observability.md`
- Runtime stage timing contract:
  - `../../contracts/stage-timing.md`
- User-usage learning loop and continuous improvement boundary:
  - `learning-loop.md`
- Langfuse LLM observability / eval platform boundary:
  - `langfuse.md`
- Code organization, decomposition and package ownership:
  - `code-organization.md`
- Runtime delivery, readiness and release hardening architecture:
  - `runtime-release.md`
- Document site and file asset architecture:
  - `document-site.md`
  - `file-asset-loader.md`
- Identity, authorization and account boundary:
  - `identity-authz.md`
  - `identity-platform.md`
  - `identity-browser.md`
  - `mucwiki-login.md`
- Operator Console operations domain and current implementation boundary:
  - `operator-console.md`
- Retired or offline Python boundary:
  - `python-boundaries.md`

## Use Rules

- This directory owns cross-domain supporting truth only.
- Domain-level source-channel details belong in `../domains/`.
- Contract and schema details belong in `../../contracts/` or `../../data/`.
- Staging/release validation and operational procedure belong in `../../runbooks/`,
  `../../environment/` or `../../policies/`.
- Completion ledgers, verification mappings and quality baselines belong in
  `../../reference/`.
- Workstream state and backlog signals belong in `.planning/`.
