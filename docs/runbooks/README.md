---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-20
---

# Runbooks

`runbooks/` 保存可重复执行的操作步骤、部署流程和验收手册。
当前仍建议直接执行的操作文档保持 `active`；legacy 或只保留对照价值的流程改为 `historical`。

## Core Deploy / Smoke / Release

- `staging-worker-deploy-runbook.md`
- `forward-worker-surface-smoke-runbook.md`
- `develop-main-release-runbook.md`
- `index-release-runbook.md`

## Collaboration / Workstream Claims

- `workstream-claim-workflow.md`
- `public-product-path-safety-ops-runbook.md`

## Environment-Specific Smoke / Evidence

- `dev-backed-supervisor-staging-operations.md`
- `dev-backed-supervisor-staging-smoke-runbook.md`
- `worker-observability-smoke-runbook.md`
- `templates/public-chat-staging-smoke-artifact-template.md`
- `templates/worker-observability-smoke-artifact-template.md`

## Local Infra / Recovery

- `local-postgres-dev-recovery-runbook.md`
- `qdrant-cloud-backup-and-restore-runbook.md`
- `provider-secret-governance.md`
- `legacy-office-conversion-runtime.md`

## Authenticated Notice / Internal Notice

- `authenticated-notice-file-release-auth-window-runbook.md`
- `authenticated-notice-bootstrap-smoke-runbook.md`
- `authenticated-notice-source-truth-replay-runbook.md`
- `authenticated-notice-async-staged-closeout-runbook.md`
- `internal-notice-policy-regulation-promotion-runbook.md`
- `internal-notice-regulation-target-quality-acceptance-runbook.md`

## Official Web

- `official-web-collector-smoke-and-audit.md`
- `official-web-dynamic-shell-discovery.md`
- `official-web-source-truth-projection-replay.md`

## Collection rebuild checklists

- `student-handbook-hybrid-rebuild-checklist.md`
- `curriculum-plan-hybrid-rebuild-checklist.md`

## Historical / Comparison Archive

- `archive/README.md`
  - historical runbook、legacy path redirect 与已退出默认执行面的旧模板已统一下沉到 archive namespace
