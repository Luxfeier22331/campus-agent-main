---
doc_type: runbook
truth_scope: ops
owner_boundary: docs/runbooks
status: active
created: 2026-03-29
updated: 2026-03-29
---
# Develop Main Release Runbook

## 文档边界

这份 runbook 只回答当前仓库的分支集成与稳定发布流程：

- `develop` 承担什么职责
- feature worktree 应该先合到哪里
- `main` 应该在什么时机接收变更
- 紧急修复如何回灌

它不替代：

- 长期分支模型定义：`README.md`、`AGENTS.md`
- 当前执行状态：`.planning/PROJECT.md`、`.planning/WORKSTREAMS.md` 与
  GSD SDK / Codex native session
- 具体验证命令与 smoke 边界：`docs/runbooks/forward-worker-smoke.md`

## 当前分支职责

- `develop` 长期集成分支；当前 merged truth 默认指已经回到 `develop` 的状态
- `main` 稳定分支；只承接已经完成集成、验证并准备发布的一批内容
- feature worktree / feature branch 隔离开发面；在合回 `develop` 前，不得被描述成当前 merged truth

## 目标流程

当前仓库采用：

`worktree feature -> develop -> main`

具体含义是：

- RAG 主链路可以继续直接在 `develop` 推进
- `panel`、`chat`、`official_web` 之类独立功能优先在各自 worktree 分支中开发
- 这些功能准备进入主集成面时，先合回 `develop`
- `main` 只通过 `develop -> main` 的 release merge 同步进度，不直接接 feature/worktree 分支

## Feature Worktree 到 Develop

默认做法：

1. feature worktree 基于最新 `develop` 建立
1. worktree 开发期间周期性同步 `develop`
1. 在 worktree 内完成本功能所需验证
1. 通过 PR 或 merge 将 feature worktree 合回 `develop`

适用范围：

- `apps/operator-console-web`
- `apps/campus-web`
- `apps/app-api` 上为 web surface 配套的 shared seam 变更
- 其他不应直接打断主链路开发节奏的独立功能

约束：

- feature worktree 不直接合入 `main`
- 如果 worktree 还没有回到 `develop`，其实现只能被描述为 worktree-local progress
- 合流时不得回退 `develop` 已冻结的 shared seam、contract 或架构约束

## Develop 到 Main

`main` 的同步不是“把零散功能直接补进稳定分支”，而是“发布某个时点已经稳定的 `develop` 快照”。

标准做法：

1. 在 `develop` 上确认本轮准备发布的功能集合
1. 运行本轮 release 所需验证和 smoke
1. 确认没有必须阻塞发布的未收口改动
1. 将 `develop` merge 到 `main`
1. 在 `main` 上打 release tag 或记录稳定版本快照

这意味着：

- `main` 同步的是 `develop` 的一批已集成内容
- 如果某个 worktree 功能没有先进入 `develop`，它就不应出现在这轮 `main` 发布中

## 推荐节奏

日常：

- `develop` 持续前进
- feature worktree 周期性跟进 `develop`
- 准备好的功能持续并入 `develop`

发布时：

- 从 `develop` 选定一个 release cut 点
- 对该 cut 点运行 release gate、smoke 和必要手工验收
- 通过后执行 `develop -> main`

## Main Hotfix 回灌

如果稳定分支出现必须直接修复的问题，可以在 `main` 上做 hotfix。

但 hotfix 完成后必须：

1. 把 hotfix 同步回 `develop`
1. 确认 `develop` 不再缺失这次修复

否则 `develop` 和 `main` 会长期分叉，后续 release merge 会反复冲突。

## 什么时候不该直接发布到 Main

以下情况不应直接做 `develop -> main`：

- `develop` 上还有本轮明确阻塞发布的失败验证
- 准备发布的 feature worktree 还未真正回到 `develop`
- 当前工作树仍是大面积未收口的混合改动，尚未整理成明确 release cut

## 当前仓库的一句话规则

可以把当前仓库的分支流转总结为：

- worktree 负责隔离开发
- `develop` 负责集成真相
- `main` 负责稳定发布
