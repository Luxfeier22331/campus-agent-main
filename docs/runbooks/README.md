---
doc_type: index
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-04-12
updated: 2026-07-04
---
# Runbooks

`runbooks/` 保存可重复执行的操作步骤、部署流程和验收手册。
当前仍建议直接执行的操作文档保持 `active`；legacy 或只保留对照价值的流程改为 `historical`。

## Core Deploy / Smoke / Release

- `e2e-qa-release.md`
  - 上线前真实 staging E2E QA 总入口；串联 repo preflight、runtime readiness、
    public surfaces、chat、docs、panel、observability、data-plane sanity 与 release
    closeout artifacts。
- `execution-ops.md`
  - 当前 execution-control + Temporal staging runtime 运维入口。
- `forward-worker-smoke.md`
- `develop-main-release.md`
- `ingestion-control-clean-target.md`
  - 当前 ingestion/data-plane operational 入口；旧 Python collection worker
    runbook 已归档。

## Collaboration / Workstreams

- `workstream-gsd-sdk-workflow.md`
  - 当前 workstream / Codex 协作总入口；具体决策见
    `../decisions/adr-0046-gsd-sdk-and-codex-native-workflow.md`。
- `public-product-safety.md`

## Environment-Specific Smoke / Evidence

- `execution-ops.md`
  - execution-control staging deploy、ingress、daily operations、recovery 与 triage。
- `gitops-k8s.md`
  - K8s target GitOps skeleton、Argo CD Application dry-run、Helm chart
    boundary 与 secret-delivery preflight 入口；不替代当前 Docker staging
    runbook。
- `execution-smoke.md`
- `temporal-self-host-operations.md`
  - self-hosted Temporal substrate 运维入口；覆盖 persistence backup、namespace
    bootstrap、worker identity、task queue poller closeout、failure-mode closeout
    与 autoscaler posture / Docker Compose transitional validation。
- `runtime-otel-collector-pipeline.md`
- `worker-observability-smoke.md`

## Local Infra / Recovery

- `local-runtime-smoke.md`
- `provider-secret-governance.md`
- `legacy-office-conversion-runtime.md`
- `mucwiki-federation.md`
  - `muc-wiki` federation client provision and staging verification entry.
- `dining-sync.md`
  - dining catalog/review sync launch path and published snapshot verification.

## Authenticated Notice / Internal Notice

- `notice-release-auth-window.md`
- `ingestion-control-clean-target.md`
  - authenticated notice / internal notice 的 ingestion task lifecycle 入口；
    current notice mainline 使用 explicit object-store capture-release input，
    旧 Python worker / closeout 操作只作为历史追溯材料。

## Official Web

- `ingestion-control-clean-target.md`
  - official-web ingestion / release task lifecycle 入口；旧 collector smoke 与
    source-truth projection replay runbook 已归档。

## Collection rebuild checklists

- `rag-release.md`
  - current RAG collection rebuild / release acceptance entry for
    `student_rules` and `curriculum_plan`

## Eval / Acceptance automation

- `eval-ragas.md`
- `eval-operations-governance.md`

## Historical Material

旧 Qdrant Cloud backup、Python ingestion worker runbook 和其他只剩追溯价值的
runbook 正文已退出 branch tip；需要旧链路时通过 git history 恢复具体片段，再提升到当前
runbook 或 architecture 文档。
