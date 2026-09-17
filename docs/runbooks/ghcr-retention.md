---
doc_type: runbook
owner_boundary: runtime-release
status: active
---

# GHCR 缓存清理

## 当前边界

`ghcr-retention` 当前只清理已关闭 PR 的 `campus-agent/pr-cache-<number>/<image>` 缓存包。
包名由 PR 编号和 `scripts/release/image-targets.mts` 的当前目标推导，直接查询 package 和分页
versions，不依赖组织级包枚举。不会扫描历史 PR，也不操作正式镜像或主线缓存。

正式镜像定期清理已暂停，旧的最近 5 个 release 和七天宽限期不再通过 workflow 或 CLI 执行。
正式版本、部署引用和发布恢复目标的保留依据由 #512 完善，再由 #511 接入自动清理。
暂停期间不能把无版本号或无标签当作删除依据。

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

- `pr_number`：必填，已关闭的同仓非 Dependabot PR 编号。
- `mode`：默认 `report`，只读计划；`apply` 执行构建协调、删除和复查。

手动运行使用所选 ref 的代码；日常操作选择默认分支。report 不取消构建，也不删除缓存。
CLI 等价入口如下，省略 `--pr-cache-pr` 或使用旧全量清理参数会失败，不发起网络请求：

```bash
node --experimental-strip-types scripts/release/ghcr-retention.mts \
  --pr-cache-pr 508 --mode report --output ghcr-retention.json
```

确认目标后将 mode 改为 `apply`。失败时先检查报告中的操作和错误，修复原因后使用同一 PR 编号
重新执行；不需要组织全量扫描。未出现在当前镜像目标中的历史遗留包需按具体对象另行处理。

## 结果与权限

沿用 JSON report 和 Actions summary。apply 前保存计划，读取、删除或复查失败后更新报告，
标明失败操作并返回非零退出码；删除失败可能已完成部分操作，报告中的计划不代表全部执行成功。
脚本运行前的环境初始化失败由原步骤日志说明，不追加报告文件缺失的上传错误。

workflow 使用 `contents: read`、`pull-requests: read`、`actions: write`、`packages: write`。
API 删除还要求 token 对目标 package 具备相应权限；失败时报告原因，不切换个人 PAT 或扩大组织权限。
本地凭据的成功不能替代真实 workflow token 的验收。

## 相关决策

- [PR 缓存直查与暂停全量清理](../../.agents/notes/implemented/process/2026-09-17-ghcr-pr-cache-direct-cleanup.md)
- [原镜像保留与退役决策](../../.agents/notes/implemented/process/2026-09-04-ghcr-retention.md)
