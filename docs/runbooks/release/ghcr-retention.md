---
doc_type: runbook
owner_boundary: runtime-release
status: active
---

# GHCR 缓存清理

## 当前边界

`ghcr-retention` 负责 `campus-agent/*` GHCR package 的 report/apply。PR 关闭入口只清理
`campus-agent/pr-cache-<number>/<image>`；full report/apply 读取当前 active image package、GitOps
`main` 和可用的 `deploy/staging` 引用，并保护当前 cache、最近 10 次 release、GitOps 引用及其 OCI
manifest closure。

正式镜像和 canonical cache 不能按“无 tag”直接删除。默认保留最近 10 个 SHA release，未标记版本
保留 90 天；当前 GitOps digest、当前 `buildcache-arm64` root 及其 child/referrer 始终受保护。
full apply 先人工审阅 report，稳定运行多个 report 后再考虑自动化。

## 自动清理

同仓非 Dependabot PR 关闭或合并时，`pull_request_target: closed` 使用默认分支代码自动 apply。
清理先确认 PR 已关闭且属于本仓，再取消其未完成的 `pr` workflow runs，每 5 秒检查一次，最多
等待 10 分钟。run 关联缺失时沿用分支和提交归属检查；无法确认、超时或 API 失败就停止。

随后直接读取目标缓存包，复查 PR 状态，整包删除并直查确认消失。不同 PR 使用不同并发组；同一
PR 的自动和手动清理共享并发组。构建登录缓存前检查实时 PR 状态，关闭或查询失败时禁止远程
缓存读写，避免清理后重写。

包 metadata 直查的 HTTP 404 视为缺失，前提是 workflow 对目标 package 的可见权限正确。
versions、PR 查询、删除和复查的其他错误不会被当作空库存。全部目标已经不存在时，PR 资格检查
通过后可以成功重复执行。

## 手动补做

在 `ghcr-retention` 的 Run workflow 中填写：

- `scope`：`pr`（默认）清理一个已关闭 PR；`full` 只生成已登记 package 范围的正式镜像/cache report。
- `pr_number`：scope 为 `pr` 时填写已关闭的同仓非 Dependabot PR 编号。
- `mode`：`report` 只读计划；`apply` 执行删除。PR apply 还会先停止该 PR 的未完成构建。

手动运行使用所选 ref 的代码；日常操作选择默认分支。report 不取消构建，也不删除缓存。
CLI 等价入口如下：

```bash
# Full report: GitOps checkout must contain main and optional deploy/staging refs.
node --experimental-strip-types scripts/release/ghcr-retention.mts \
  --scope full --gitops-root ./gitops-retention --gitops-refs main,deploy/staging \
  --mode report --output ghcr-retention.json

# Closed PR cache report.
node --experimental-strip-types scripts/release/ghcr-retention.mts \
  --scope pr --pr-cache-pr 508 --mode report --output ghcr-retention.json
```

full scope 当前只允许 `report`，不能通过 workflow 直接 apply；确认目标后再使用同一脚本在受控环境中执行
`--mode apply`。失败时先检查报告中的操作和错误，修复原因后重新生成 report；
不要复用过期的 apply 文件。未登记的 package、无法读取 GitOps 引用、manifest inspection 失败或
保护 root 缺失都会停止 full apply。

## 结果与权限

沿用 JSON report 和 Actions summary。apply 前保存计划，读取、删除或复查失败后更新报告，
标明失败操作并返回非零退出码；删除失败可能已完成部分操作，报告中的计划不代表全部执行成功。
脚本运行前的环境初始化失败由原步骤日志说明，不追加报告文件缺失的上传错误。

workflow 使用 `contents: read`、`pull-requests: read`、`actions: write`、`packages: write`；full
scope 额外使用 GitHub App token 读取 `campus-agent-gitops`。
API 删除还要求 token 对目标 package 具备相应权限；失败时报告原因，不切换个人 PAT 或扩大组织权限。
本地凭据的成功不能替代真实 workflow token 的验收。

## 相关文档

- [PR 缓存直查与暂停全量清理](../../../.agents/notes/implemented/process/2026-09-17-ghcr-pr-cache-direct-cleanup.md)
- [原镜像保留与退役决策](../../../.agents/notes/implemented/process/2026-09-04-ghcr-retention.md)
