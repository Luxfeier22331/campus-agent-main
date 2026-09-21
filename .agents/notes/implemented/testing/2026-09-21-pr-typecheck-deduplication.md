# Agent Note: PR 类型检查去重

Status: implemented

## 背景

pre-commit 已执行受影响 Node typecheck，PR 使用同一任务再次检查。共享 runner 资源紧张，
用户要求清理这项重复开销，保持现有内存限制。

## 决策

Node typecheck 保留在 pre-commit、手动 verify 和 package 命令。PR 的 Node 任务集合只含
现有测试；构建集合继续独立执行。计划选择、workspace 安装范围和执行器统一使用 PR 集合，
仅类型检查受影响时不启动 PR Node 检查。不增加本地验证凭证或缓存证明机制。

本篇部分取代[提交前验证与根测试缓存](../process/2026-09-16-pre-commit-validation.md)中
PR 重复执行 Node typecheck 的范围；提交 hook、推送边界和其他检查保持原有职责。

## 未采用方案

保留 PR 类型检查能够验证合并结果，但会重复消耗当前紧张的 runner 资源；本次明确选择本地
检查。提高 runner 内存上限可以容纳检查，但用户要求保持限制并去除重复工作。

## 后果

PR 不再提供独立的 Node 类型检查结论；rebase 后需要检查时运行 package typecheck 或 verify。
测试验证 PR 排除类型检查且保留测试、构建，类型检查独占变化不选择安装，本地 hook 继续检查类型。
