---
doc_type: index
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-04-12
updated: 2026-06-13
---
# Runbooks

`runbooks/` 保存可重复执行的操作步骤、部署流程和验收手册。
当前仍建议直接执行的操作文档保持 `active`；legacy 或只保留对照价值的流程改为 `historical`。

## Core Deploy / Smoke / Release

- `e2e-qa-release-runbook.md`
  - 上线前真实 staging E2E QA 总入口；串联 repo preflight、runtime readiness、
    public surfaces、chat、docs、panel、observability、data-plane sanity 与 evidence closeout。
- `execution-control-staging-operations.md`
  - 当前 execution-control + Temporal staging runtime 运维入口。
- `forward-worker-surface-smoke-runbook.md`
- `develop-main-release-runbook.md`
- `ingestion-control-clean-target-runbook.md`
  - 当前 ingestion/data-plane operational 入口；旧 Python collection worker
    runbook 已归档。

## Collaboration / Workstreams

- `workstream-gsd-sdk-workflow.md`
  - 当前 workstream / Codex 协作总入口；具体决策见
    `../decisions/adr-0046-gsd-sdk-and-codex-native-workflow.md`。
- `public-product-path-safety-ops-runbook.md`

## Environment-Specific Smoke / Evidence

- `execution-control-staging-operations.md`
  - `execution-control-staging/deploy-and-ingress.md`
  - `execution-control-staging/daily-operations-and-recovery.md`
  - `execution-control-staging/durable-runtime-proof.md`
- `execution-control-staging-smoke-runbook.md`
- `temporal-self-host-operations.md`
  - self-hosted Temporal substrate 运维入口；覆盖 persistence backup、namespace
    bootstrap、worker identity、task queue poller evidence、failure-mode evidence
    与 worker-autoscaler dry-run proof。
- `execution-control-server-handoff.md`
- `runtime-otel-collector-pipeline.md`
- `worker-observability-smoke-runbook.md`
- `templates/e2e-qa-release-artifact-template.md`
- `templates/worker-observability-smoke-artifact-template.md`

## Local Infra / Recovery

- `execution-control-local-runtime-smoke.md`
- `provider-secret-governance.md`
- `legacy-office-conversion-runtime.md`

## Authenticated Notice / Internal Notice

- `authenticated-notice-file-release-auth-window-runbook.md`
- `ingestion-control-clean-target-runbook.md`
  - authenticated notice / internal notice 的 ingestion task lifecycle 入口；
    replay、closeout、promotion、cleanup 等旧 Python worker 操作只保留 archive
    证据。

## Official Web

- `official-web-dynamic-shell-discovery.md`
- `ingestion-control-clean-target-runbook.md`
  - official-web ingestion / release task lifecycle 入口；旧 collector smoke 与
    source-truth projection replay runbook 已归档。

## Collection rebuild checklists

- `student-handbook-hybrid-rebuild-checklist.md`
- `curriculum-plan-hybrid-rebuild-checklist.md`

## Eval / Acceptance automation

- `eval-release-gate-automation.md`
- `eval-operations-governance.md`

## Historical / Comparison Archive

- `archive/README.md`
  - historical runbook、legacy path redirect 与已退出默认执行面的旧模板已统一下沉到 archive namespace
- `archive/python-ingestion-worker/`
  - historical Python ingestion worker runbook；只用于追溯旧链路，不是当前操作入口。
- `archive/qdrant-cloud-backup-and-restore-runbook.md`
  - historical Qdrant Cloud / Free tier backup reference；当前默认方案已切换到
    self-hosted single-node Qdrant native snapshots。
