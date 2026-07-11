---
doc_type: index
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-04-12
updated: 2026-07-10
---
# Runbooks

`runbooks/` 保存可重复执行的操作步骤、部署流程和验收手册。
`active` runbook 必须描述当前可执行入口；只剩对照价值的历史流程不得留在
branch tip 作为默认操作说明。

## Core Deploy / Smoke / Release

- `e2e-qa-release.md`
  - 上线前真实 staging E2E QA 总入口；串联 repo preflight、runtime readiness、
    public surfaces、chat、docs、panel、observability、data-plane sanity 与 release
    closeout artifacts。
- `execution-ops.md`
  - 当前 execution-control + Temporal staging runtime 运维入口。
- `forward-worker-smoke.md`
- `main-release.md`
- `ingestion-control-clean-target.md`
  - 当前 ingestion/data-plane operational 入口。

## Collaboration / Workstreams

- `workstream-gsd-sdk-workflow.md`
  - 当前 workstream / Codex 协作总入口；具体决策见
    `../decisions/adr-0046-gsd-sdk-and-codex-native-workflow.md`。
- `public-product-safety.md`

## Environment-Specific Smoke / Evidence

- `execution-ops.md`
  - execution-control staging deploy、ingress、daily operations、recovery 与 triage。
- `gitops-k8s.md`
  - source/environment repository boundary、Argo CD bootstrap、immutable image
    promotion、secret delivery 与 Kubernetes staging 验证入口。
- `execution-smoke.md`
- `temporal-self-host-operations.md`
  - self-hosted Temporal substrate 运维入口；覆盖 persistence backup、namespace
    bootstrap、worker identity、task queue poller closeout、failure-mode closeout
    与 KEDA autoscaler posture validation。
- `runtime-otel-collector-pipeline.md`
- `worker-observability-smoke.md`

## Local Infra / Recovery

- `local-runtime-smoke.md`
- `provider-secret-governance.md`
- `mucwiki-federation.md`
  - `muc-wiki` federation client provision and staging verification entry.
- `dining-sync.md`
  - dining catalog/review sync launch path and published snapshot verification.

## Authenticated Notice / Internal Notice

- `notice-release-auth-window.md`
- `ingestion-control-clean-target.md`
  - authenticated notice / internal notice 的 ingestion task lifecycle 入口；
    current notice mainline 使用 explicit object-store capture-release input。

## Official Web

- `ingestion-control-clean-target.md`
  - official-web ingestion / release task lifecycle 入口。

## Collection rebuild checklists

- `rag-release.md`
  - current RAG collection rebuild / release acceptance entry for
    `student_rules` and `curriculum_plan`

## Eval / Acceptance automation

- `eval-ragas.md`
- `eval-operations-governance.md`

## Historical Material

只剩追溯价值的 runbook 正文不保留在 active docs。需要恢复旧链路时，通过
git history 找到具体片段，再通过新的设计评审提升为当前 runbook 或 architecture 文档。
