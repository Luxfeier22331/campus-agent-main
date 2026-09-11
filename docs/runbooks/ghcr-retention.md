---
doc_type: runbook
owner_boundary: runtime-release
status: active
---

# GHCR 镜像保留与清理

## 边界

本手册只处理 `ghcr.io/muc-wiki/campus-agent/*` 的 GHCR package version 和 package 生命周期。
源码仓负责构建并发布镜像，GitOps 仓负责选择不可变 digest，Argo CD 和 Kubernetes 消费 GitOps
期望状态；清理 workflow 只根据这些 owner 的事实做盘点和删除，不修改 GitOps、集群或数据库。

active image target 由
[`scripts/release/image-targets.mts`](../../scripts/release/image-targets.mts) 拥有，退役 package allowlist
由 [`scripts/release/ghcr-retention.mts`](../../scripts/release/ghcr-retention.mts) 拥有。GHCR 中出现未登记的
`campus-agent/*` package 时，清理会报告错误并拒绝 apply。把 package 加入退役 allowlist 前，必须在
对应 Issue 或 PR 中保存 GitOps、集群资源和节点缓存的核验结果；这些一次性审计证据不进入长期文档。

## 策略

清理 workflow 默认只生成 report。active package 的 version 只有在以下条件均不成立时才可删除：

- GitOps `main` 和所有同仓、未合并的 GitOps promotion PR 中没有引用该 digest；
- 该版本不在最近 5 个 SHA-tagged release 中；
- 该版本不是当前 `buildcache-arm64` tag；
- 该版本不是受保护 OCI root 的 child manifest 或 attestation manifest；
- 对无 tag 版本而言，更新时间已经超过 7 天宽限期。

SHA-tagged release 窗口和无 tag 宽限期是当前小规模 staging 的初始运维策略，不是外部平台合同。
发布频率、回滚窗口或环境数量发生变化时，应在清理 workflow 的手动输入和对应决策中重新评估。
未知 tag 不自动删除，而是保持并报告，等待 owner 登记语义。

`campus-agent/pr-cache-<number>/<active-image>` 是 PR 缓存包，由同一清理入口管理。源码 PR 开放期间
保护当前 `buildcache-arm64` 及其 manifest closure，无 tag 历史版本保留 7 天。PR 关闭或合并满同一
宽限期后形成整包删除候选；未到期不删包。源码 PR 状态不可读取或无效时保持缓存并报告 policy error，
禁止 apply。查询按 PR 号去重，需要 Source 仓 `pull-requests: read` 权限；默认 report、手动 apply
保持不变。apply 后仅复查保留包的 manifest，不读取刚删除的缓存包。

退役包不按 version 猜测删除，而是由显式 allowlist 直接形成整包删除候选。默认 scheduled/manual
`report` 只生成计划；选择 workflow 的 `apply` 模式才执行删除，因此 `apply` 是对整包删除的人工确认。
任何 GitOps 引用退役包、active package 缺失、未登记 package 或保护 digest 缺失，都会使 apply 失败。
重新启用某个历史包时，先把它恢复到 active image target 和 GitOps consumer，再执行清理；不要只删除
allowlist 条目。

## 执行

手动或定时 workflow 使用 Source 仓的
[`ghcr-retention.yml`](../../.github/workflows/ghcr-retention.yml)：

```text
report: 盘点 GHCR、GitOps 和 OCI manifest closure，上传结构化报告，不删除
apply: 使用同一份实时盘点结果删除计划中的 active versions、退役 packages 或过期 PR 缓存包
```

GitHub API 按 package version ID 删除。apply 后 workflow 重新读取 package inventory，并重新检查
active protected root 及其 OCI manifest closure；保护 root、runtime manifest 和 attestation 不完整时
任务失败。清理与 staging 镜像发布共用 `campus-agent-ghcr-mutation` concurrency group，避免同时
修改同一 package。

GitHub Actions 需要 package write 权限；`GITHUB_TOKEN` 只有在该 workflow 对 package 具有 admin
权限时才能执行删除。当前 package 由同一 Source 仓发布并关联，若权限或组织策略不满足，保留 report
并由 package owner 处理，不改用个人 token 或直接删除 registry 内容。

## 相关决策

- [ADR-0095 GHCR 镜像保留与退役](../decisions/adr-0095-ghcr-retention.md)
- [运行时发布架构](../architecture/system/runtime-release.md)
- [发布](./release.md)
