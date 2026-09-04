---
doc_type: decision
owner_boundary: runtime-release
decision_id: ADR-0095
status: accepted
---

# ADR-0095 GHCR 镜像保留与退役

## 背景

`campus-agent` Source 仓持续向 GHCR 发布按 commit SHA 标记的镜像。BuildKit 同时写入每个镜像的
`buildcache-arm64` registry cache，并可能产生 OCI image index、platform manifest 和 attestation
manifest。GHCR package version 列表因此不能简单按“无 tag”或年龄删除。

本仓库的实际发布 owner 是 Source 仓；实际环境选择 owner 是 GitOps 仓；Kubernetes/Argo CD 消费
GitOps 中的不可变 digest。active image target 由
[`scripts/release/image-targets.mts`](../../scripts/release/image-targets.mts) 定义。历史 package 是否仍有
消费者必须以 GitOps、集群资源和节点缓存为证，不能以旧 README 或历史源码命名推断。具体退役核验
结果属于对应 Issue、PR 或 workflow report，不进入长期架构决策。

## 决策

- Source 仓的 `ghcr-retention` workflow 是 `campus-agent/*` GHCR 清理 owner；外部 registry、GitOps
  变更、集群操作和业务数据库不属于它的职责。
- active package 保护 GitOps `main` 和同仓 open promotion PR 的所有不可变 digest，最近 5 个 SHA
  release、当前 `buildcache-arm64` root，以及所有受保护 OCI root 的 child manifest/referrer。
- active package 的未知 tag 不自动删除；超过 7 天的无 tag version 和 release window 之外的 SHA
  version 才进入 report/apply 计划。
- 历史包使用显式 allowlist，直接形成整包删除候选；scheduled/manual `report` 不删除，workflow 的
  `apply` 模式是整包删除的人工确认，不为名称看似特殊的 package 建立隐式保留例外。
- 清理前生成可审计 JSON report；apply 使用 package version ID 或 whole-package API；apply 后重新
  读取 inventory 并验证 protected manifest closure。清理和镜像发布共用 GHCR mutation concurrency。

## 信任边界与失败处理

GitOps digest 是环境选择事实，Kubernetes 和节点缓存是线上消费者交叉证据，GHCR API 的 version ID
是删除接口所需的远端身份。现有发布脚本只负责发布和输出 digest，不拥有 package inventory、删除
权限或历史包分类，因此不足以承担清理；也不能用 tag 数量替代 manifest graph 保护。

缺少 active package、出现未登记 package、GitOps 引用退役包、保护 digest 不在 inventory、OCI
manifest inspection 失败或删除后保护 graph 不完整时，workflow 停止，不 fallback 到模糊匹配或强制
删除。apply 失败后只重跑 report，依据新的 GitOps/registry 状态重新生成计划。

## 重新评估与删除条件

以下任一条件成立时重新评估 5 个 release、7 天宽限期或退役 allowlist：发布/回滚窗口扩大，新增
production 或其他 GitOps 环境，BuildKit cache tag 改变，历史包重新进入 workload/GitOps，或
GitHub Packages 删除权限/接口行为改变。源码目录只有在其本地测试和合同同时移除后才可另行删除；
GHCR package 退役不自动删除仍被本地测试或开发数据库使用的 migration 代码。

## 相关文档

- [GHCR 镜像保留与清理](../runbooks/ghcr-retention.md)
- [运行时发布架构](../architecture/system/runtime-release.md)
- [ADR-0083 Staging 版本选择](./adr-0083-promotion.md)
