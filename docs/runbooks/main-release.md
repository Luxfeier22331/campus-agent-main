---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-03-29
updated: 2026-07-08
---
# Main Release Runbook

## 文档边界

这份 runbook 只回答当前仓库的分支集成、staging 验证与 production
release 流程：

- feature worktree 应该如何合入主干
- `main` 承担什么职责
- staging 自动部署如何触发
- production release 如何选择 ref
- 紧急修复如何回到主干

它不替代：

- 具体验证 lane：`docs/reference/testing-and-verification-lanes.md`
- staging E2E 验收：`docs/runbooks/e2e-qa-release.md`
- 当前执行状态：`.planning/PROJECT.md`、`.planning/WORKSTREAMS.md` 与
  GSD SDK / Codex native session

## 当前分支职责

- `main` 是长期集成与稳定主干；当前 merged truth 默认指已经合入
  `main` 的状态。
- feature worktree / feature branch 是隔离开发面；合入 `main` 前，只能
  描述为 worktree-local progress。
- release tag 和 GitHub `production` Environment 承接生产发布选择，不再用
  长期开发分支作为发布中转。

## 目标流程

当前仓库采用：

`worktree feature -> PR -> main -> staging -> release tag / production preflight`

具体含义是：

- 所有功能和修复默认从短生命周期 worktree / branch 发起 PR。
- PR 以 `main` 为 base，并通过 `pr / required` 聚合检查。
- 合入 `main` 后，`deploy-staging` 可以自动部署 staging 并记录 GitHub
  deployment。
- production 只选择已合入 `main` 的 ref 或 release tag，并通过
  `production-preflight` 和 GitHub `production` Environment 控制。

## Feature Worktree 到 Main

默认做法：

1. feature worktree 基于最新 `main` 建立。
1. worktree 开发期间按需同步 `main`。
1. 在 worktree 内完成本功能所需验证。
1. 通过 PR 合入 `main`。

约束：

- feature worktree 不绕过 PR 直接进入 release / production。
- 如果 worktree 还没有回到 `main`，其实现不能被描述成当前 merged truth。
- 合流时不得回退 `main` 已冻结的 shared seam、contract 或架构约束。

## Main 到 Staging

`main` push 触发 `.github/workflows/pr.yml` 的主干健康检查；staging 部署由
`.github/workflows/deploy-staging.yml` 承接。

标准做法：

1. PR 合入 `main` 前确认 `pr / required` 为 success。
1. 合入后等待 `main` push 上的 repo health lane 和 staging deploy 结果。
1. staging 验证只在 GitHub deployment、Worker probes 和必要 runbook
   证据都存在时才视为完成。

## Production Release

production 不从 feature branch 或 worktree 直接取 ref。

标准做法：

1. 在 `main` 上选择准备发布的 commit。
1. 为该 commit 创建 release tag，或在 `production-preflight` 中显式选择该
   `main` ref。
1. 运行本轮 release 所需验证、smoke 和必要手工验收。
1. 通过 GitHub `production` Environment 审批后继续生产发布步骤。

当前 `production-preflight` 只做受保护的生产预检。真实 production deploy、
rollback 和 artifact attestation 需要在产物链路明确后再接入。

## Main Hotfix

紧急修复仍走短分支：

1. 从最新 `main` 建立 hotfix branch / worktree。
1. 修复并运行受影响验证。
1. 通过 PR 合入 `main`。
1. 如需生产发布，为合入后的 `main` commit 创建 release tag 或执行
   `production-preflight`。

## 什么时候不该发布

以下情况不应进入 production release：

- 目标 ref 尚未合入 `main`。
- `pr / required` 缺失、失败或被取消。
- staging deploy / smoke 缺少本轮必须的证据。
- release 依赖的 image、bundle、secret 或 GitOps bootstrap 尚未真实存在。

## 当前仓库的一句话规则

- worktree 负责隔离开发。
- `main` 负责集成真相。
- release tag 和 GitHub Environment 负责生产发布选择。
