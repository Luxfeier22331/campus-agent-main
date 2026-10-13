---
doc_type: runbook
owner_boundary: runtime-release
status: active
---

# GHCR 镜像保留与清理

## 边界

Source 的 `ghcr-retention` 管理登记的 active/retired 镜像包，以及指定编号的历史 PR 缓存。
PR CI 只读取 canonical main cache，不再导出 PR cache，也不在 PR 关闭时启动清理。
full 每日执行 apply，同时支持手动 report/apply；执行时间由
[workflow schedule](../../../.github/workflows/ghcr-retention.yml) 维护。

full 的保护根来自 GitOps exporter：未退役正式 Release 的不可变 `release.json`、当前环境期望状态、
滚动候选、最后成功的 Deployment、在途/失败恢复 Deployment，以及 Source 可恢复候选和当前
canonical cache。所有根与 OCI child manifest 取并集；版本退役不会删除仍被其他版本或环境引用
的 digest。已退役组件包只要还有根就继续保留，不能整包删除。

候选历史以最后成功 Deployment 的 candidate 为边界，保留该候选及之后尚可晋级的候选。
Source OCI 快照按最后成功的常规快照创建时间划界，同时保护该快照和之后快照的引用镜像，覆盖 GitOps
尚未完成的组装交接；latest 始终保留。首次成功前保留全部候选。被新成功发布取代的普通候选退出
恢复范围；需要历史选版时使用正式版本。旧选版分支和候选归档文件不再永久保护制品。

正式版本没有独立的 SHA 数量窗口，普通候选也没有默认七天保留承诺。未知 tag 保留；active 包
保留包本身，清理无引用版本。Release/asset、Deployment、GitOps revision 或 registry 查询失败
不能当作空根。active 包缺失会阻止 apply；历史 PR 缓存或 retired 包的 metadata 404 仅在可见权限
正确时视为缺失，其他读取、传输和解析错误均失败。

## 前置条件

使用 main 上的 workflow。Source token 需要读取 contents、Actions 候选、commit statuses，并对组织 Packages
具备读取与删除权限；PR scope 另需读取 PR 状态。full workflow 使用任务声明 `packages: write` 的
`GITHUB_TOKEN` 访问已授权给 Source 仓库的 package inventory 和删除接口；包须向该仓库授予 Admin
Actions access。GitOps App token 仍只读环境仓 contents 和 deployments。不能用本地
凭据成功替代真实 workflow token 的删除验收。

Retention 的 active package 注册表独立于 Source 的镜像构建目标：除构建目标外，还登记当前 GitOps
仍选择的 `internal-portal-collection`、`notice-classifier`、`notice-index-publisher` 和
`notice-publisher`。只要 GitOps 仍引用这些包，它们就属于 active 保留边界；不把构建目标清单当作
GHCR inventory 的完整事实来源。

候选发布、正式版本创建和 full apply 共用 workflow 级 `campus-agent-ghcr-mutation` 并发组，
`cancel-in-progress: false`、`queue: max`，按队列执行。full report 使用独立组；历史 PR 缓存按编号
隔离。不再授予清理 workflow 取消 PR 构建的 Actions 写权限。

## 操作步骤

在 `ghcr-retention` 的 Run workflow 中选择 main 并填写：

- `scope=full`（默认）：管理登记的正式镜像/cache；`scope=pr`：清理一个已关闭的同仓非 Dependabot PR。
- `mode=report`（默认）：生成只读计划；`mode=apply`：重新计算计划、复查并执行删除。
- `pr_number`：仅 PR scope 填写。

先运行 report 检查删除范围，再运行 apply。apply 不消费先前报告：full 会刷新 GitOps main 和
候选分支历史，按成功 Deployment 边界重新导出候选、正式版本和部署保留根，并读取 registry inventory；删除前再做一次完整刷新，
仅执行两次计划中都允许删除的相同 version ID/digest，整包删除也不覆盖新出现的版本。随后重新
读取 inventory，确认目标消失、active 包及受保护根和子 manifest 仍在。

PR scope 先检查 PR 资格、直查对应缓存包，删除前复查 PR 状态，删除后确认包消失；不会取消构建。
目标已经不存在时可重复执行，不为了验收重新生成 PR 缓存。

CLI 调试入口如下；full 会 fetch 并切换 GitOps checkout，因此只使用专用、干净的临时 checkout，
先安装其冻结依赖。`GH_TOKEN`/`SOURCE_TOKEN` 用于 Source，`GITHUB_TOKEN` 用于 GitOps。workflow
已准备这些环境及 registry 登录；本地 apply 不能获得 Actions 并发锁，实际删除使用 workflow。

```bash
node --experimental-strip-types scripts/release/ghcr-retention.mts \
  --scope full --gitops-root ./gitops-retention \
  --release-roots ./release-roots.json --mode report --output ghcr-retention.json

node --experimental-strip-types scripts/release/ghcr-retention.mts \
  --scope pr --pr-cache-pr 508 --mode report --output ghcr-retention.json
```

定时事件在 main 上执行同一 full apply 路径并持有发布 mutation 锁；不会进入历史 PR 缓存清理。
手动入口仍默认 report。判断一次 apply 成功需要 workflow 成功及删除后复查通过，不能只查看计划数量。

## 失败处理

JSON report 与 Actions summary 标明失败阶段，进程返回非零退出码。报告中的计划不表示所有删除
均已执行；失败可能发生在部分删除之后。修复实际读取、权限或保护根问题后，重新 report/apply，
使用当前状态计算剩余范围。报告 artifact 保留七天，不新增长期报告归档。

大批历史积压可能超过 job 的 60 分钟上限。超时上传的 JSON 仍可能是删除前计划，不能据此判断完成；
重新运行 report 审查剩余对象与保护集合，再运行 apply。已删除版本不在新 inventory 中，不会重放旧计划。

环境初始化失败由原步骤日志说明，不追加报告文件缺失的上传错误。package 权限不足时修复现有
workflow 的 package access，不切换个人 PAT、不扩大组织枚举权限。

## 相关文档

- [运行时发布架构](../../architecture/system/runtime-release.md)
- [候选复用与镜像清理边界](../../../.agents/notes/implemented/process/2026-10-03-source-publication-retention.md)
- [PR 缓存直查与暂停全量清理](../../../.agents/notes/implemented/process/2026-09-17-ghcr-pr-cache-direct-cleanup.md)
