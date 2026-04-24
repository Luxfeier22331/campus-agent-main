---
doc_type: index
status: active
created: 2026-04-20
updated: 2026-04-20
---
# Runbook Templates

本目录保存 runbook 配套的 artifact / summary 模板。 它们不是独立操作步骤，而是供对应 runbook 在执行时复用的落盘骨架。

## Templates

- `public-chat-staging-smoke-artifact-template.md`
  - `go-shell-staging-smoke-runbook.md` 的 public-chat staging smoke 证据模板
- `worker-observability-smoke-artifact-template.md`
  - `worker-observability-smoke-runbook.md` 的 observability smoke 证据模板

## Usage Rule

- 先执行对应 runbook，再按这里的模板落盘证据
- 模板不单独证明 smoke 通过；它们只约束证据形状与脱敏规则
