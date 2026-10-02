---
doc_type: runbook
owner_boundary: runtime-release
status: active
---

# GHCR 缓存清理

## 当前边界

`ghcr-retention` 的 PR 关闭入口只清理 `campus-agent/pr-cache-<number>/<image>`，现有行为保持不变。
full 入口只生成报告，全量删除和 schedule 由 #511 Work B 后续交付。

full report 的保护根来自 GitOps exporter：未退役正式 Release 的不可变 `release.json`、当前环境
期望状态、滚动候选、最后成功的 Deployment、在途/失败恢复 Deployment，再加当前 canonical cache。
正式版本没有独立的 SHA 数量窗口，普通候选也没有七天或 90 天的保留承诺。所有根与 OCI child
manifest 取并集；一个版本退役不会删除仍被其他版本或环境引用的 digest。已退役组件包只要还有根
就继续保留，不能整包删除。

Release/asset、Deployment、GitOps revision 或 registry 查询错误必须使报告失败，不能当作空根。
环境仓 `releases/retired.json` 只解除该正式版本的历史回滚保留资格，不解除实际部署和恢复引用。

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
# Full report: export immutable releases and deployment roots first.
pnpm --dir gitops-retention exec tsx tools/release-command.ts roots \
  --root "$PWD/gitops-retention" --output "$PWD/release-roots.json"
node --experimental-strip-types scripts/release/ghcr-retention.mts \
  --scope full --gitops-root ./gitops-retention --gitops-refs main,deploy/staging \
  --release-roots ./release-roots.json --mode report --output ghcr-retention.json

# Closed PR cache report.
node --experimental-strip-types scripts/release/ghcr-retention.mts \
  --scope pr --pr-cache-pr 508 --mode report --output ghcr-retention.json
```

full scope 在 workflow 和 CLI 均只允许 `report`。失败时修复读取、权限或保护根的实际问题，
再生成报告；本轮不启用全量 apply，也不创建定时清理入口。

## 结果与权限

沿用 JSON report 和 Actions summary。apply 前保存计划，读取、删除或复查失败后更新报告，
标明失败操作并返回非零退出码；删除失败可能已完成部分操作，报告中的计划不代表全部执行成功。
脚本运行前的环境初始化失败由原步骤日志说明，不追加报告文件缺失的上传错误。

workflow 使用 `contents: read`、`pull-requests: read`、`actions: write`、`packages: write`；full
scope 额外使用 GitHub App token 读取 `campus-agent-gitops` 的 contents 和 deployments，Source token
读取正式 Release 及不可变 asset。
API 删除还要求 token 对目标 package 具备相应权限；失败时报告原因，不切换个人 PAT 或扩大组织权限。
本地凭据的成功不能替代真实 workflow token 的验收。

## 相关文档

- [PR 缓存直查与暂停全量清理](../../../.agents/notes/implemented/process/2026-09-17-ghcr-pr-cache-direct-cleanup.md)
- [原镜像保留与退役决策](../../../.agents/notes/implemented/process/2026-09-04-ghcr-retention.md)
