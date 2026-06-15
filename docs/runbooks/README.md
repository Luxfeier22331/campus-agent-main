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
- `staging-worker-deploy-runbook.md`
- `document-reader-publish-and-docs-deploy-runbook.md`
  - 包含 serving seed export / verify / restore，以及旧
    `manifests/public-docs-reader-assets.json` root 的受控迁移清理。
- `forward-worker-surface-smoke-runbook.md`
- `develop-main-release-runbook.md`
- `index-release-runbook.md`
  - 包含 Qdrant backup retention audit；当前 collection GC 需要 qdrant-native
    filesystem snapshot evidence，历史对象存储 snapshot bundle 不能按时间或体积直接删。

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
- `templates/public-chat-staging-smoke-artifact-template.md`
- `templates/worker-observability-smoke-artifact-template.md`

## Local Infra / Recovery

- `local-postgres-dev-recovery-runbook.md`
- `execution-control-local-runtime-smoke.md`
- `self-hosted-qdrant-native-backup-runbook.md`
- `provider-secret-governance.md`
- `legacy-office-conversion-runtime.md`

## Authenticated Notice / Internal Notice

- `ingestion-worker-on-demand-batch-runbook.md`
- `authenticated-notice-processing-operator-console-runbook.md`
- `authenticated-notice-file-release-auth-window-runbook.md`
- `authenticated-notice-bootstrap-smoke-runbook.md`
- `authenticated-notice-source-truth-replay-runbook.md`
- `authenticated-notice-source-bucket-attachment-cleanup-runbook.md`
  - 包含 source attachment cleanup 与 `authenticated_notice_portal/runs/` source run
    retention audit。
- `authenticated-notice-async-staged-closeout-runbook.md`：包含 closeout operations
  evidence retention 的 audit / dry-run / delete 流程。
- `internal-notice-policy-regulation-promotion-runbook.md`
- `internal-notice-regulation-target-quality-acceptance-runbook.md`

## Official Web

- `official-web-collector-smoke-and-audit.md`
- `official-web-dynamic-shell-discovery.md`
- `official-web-source-truth-projection-replay.md`

## Collection rebuild checklists

- `student-handbook-hybrid-rebuild-checklist.md`
- `curriculum-plan-hybrid-rebuild-checklist.md`

## Eval / Acceptance automation

- `eval-release-gate-automation.md`
- `eval-operations-governance.md`

## Historical / Comparison Archive

- `archive/README.md`
  - historical runbook、legacy path redirect 与已退出默认执行面的旧模板已统一下沉到 archive namespace
- `archive/qdrant-cloud-backup-and-restore-runbook.md`
  - historical Qdrant Cloud / Free tier backup reference；当前默认方案已切换到
    self-hosted single-node Qdrant native snapshots。
