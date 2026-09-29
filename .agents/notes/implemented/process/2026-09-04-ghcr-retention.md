# Agent Note: GHCR 镜像保留与退役

Status: implemented

## 背景

`campus-agent` Source 仓持续向 GHCR 发布按 commit SHA 标记的镜像。BuildKit 同时写入每个镜像的
`buildcache-arm64` registry cache，并可能产生 OCI image index、platform manifest 和 attestation
manifest。GHCR package version 列表因此不能简单按“无 tag”或年龄删除。

本仓库的实际发布 owner 是 Source 仓；实际环境选择 owner 是 GitOps 仓；Kubernetes/Argo CD 消费
GitOps 中的不可变 digest。active image target 由
[`scripts/release/image-targets.mts`](../../../../scripts/release/image-targets.mts) 定义。历史 package 是否仍有
消费者必须以 GitOps、集群资源和节点缓存为证，不能以旧 README 或历史源码命名推断。具体退役核验
结果属于对应 Issue、PR 或 workflow report，不进入长期架构决策。

## 决策

当前执行范围保留 PR 关闭清理，并增加已登记 active/retired package 的 full report。full workflow
默认只生成报告，正式 apply 仍需在受控环境审阅报告后执行；PR 构建协调与作用域边界仍有效。

- Source 仓的 `ghcr-retention` workflow 是 `campus-agent/*` GHCR 清理 owner；外部 registry、GitOps
  变更、集群操作和业务数据库不属于它的职责。
- active package 保护 GitOps `main` 和可用 staging 引用的所有不可变 digest，最近 10 个 SHA
  release、当前 `buildcache-arm64` root，以及所有受保护 OCI root 的 child manifest/referrer。
- active package 的未知 tag 不自动删除；超过 90 天的无 tag version 和 release window 之外的 SHA
  version 才进入 report/apply 计划。
- 历史包使用显式 allowlist，直接形成整包删除候选；scheduled/manual `report` 不删除，workflow 的
  `apply` 模式是整包删除的人工确认，不为名称看似特殊的 package 建立隐式保留例外。
- 源码 PR 的 `pull_request_target: closed` 使用默认分支代码触发 scoped apply，覆盖合并冲突的
  PR；只删除该 PR 的 `pr-cache-<number>/*`，不适用无 tag 宽限期。fork 与 Dependabot 不写这些缓存，
  因此不触发关闭清理。缓存没有 PR 构建之外的消费者，这是自动删除的作用域边界。
- 清理 owner 显式取消该 PR 的未完成 `pr` runs，每 5 秒查询，最多等 10 分钟；run 关联缺失时查询
  源仓同分支的全部状态 PR，避免提交关联接口遗漏未合并关闭的 PR。唯一候选覆盖旧 SHA；分支
  复用时用 head SHA 和提交列表确认唯一匹配，歧义时停止。无法确认归属、API 错误、超时或重新
  打开都停止删除。构建登录缓存前重新读取 PR
  状态，仅 open 时允许导出，关闭或查询失败时执行无远程缓存构建。该协调需要 `actions: write`，
  用于释放关闭 PR 的构建资源并避免删除后写回；现有独立关闭触发器不能保证取消完成与删除的顺序。
- 关闭清理使用独立 per-PR concurrency group，不替换排队的发布任务；清理前后仅读取目标 PR 的
  package versions，避免不同 PR 并行删除影响全量遍历。遗漏或失败的关闭清理由定时 report 列出
  满 7 天的候选，再手动 apply；定时 report 不自动删除。
- full inventory 只读取 image target 清单中的 active/retired package，不进行组织级 package 枚举。
  清理前生成可审计 JSON report；apply 使用 package version ID 或 whole-package API；apply 后重新
  读取 inventory 并验证 protected manifest closure。定时/手动清理和镜像发布共享 mutation
  concurrency，PR 关闭路径使用独立 per-PR 组，apply 后确认目标包消失。

### 信任边界与失败处理

GitOps digest 是环境选择事实，Kubernetes 和节点缓存是线上消费者交叉证据，GHCR API 的 version ID
是删除接口所需的远端身份。现有发布脚本只负责发布和输出 digest，不拥有 package inventory、删除
权限或历史包分类，因此不足以承担清理；也不能用 tag 数量替代 manifest graph 保护。

缺少 active package、出现未登记 package、GitOps 引用退役包、保护 digest 不在 inventory、OCI
manifest inspection 失败或删除后保护 graph 不完整时，workflow 停止，不 fallback 到模糊匹配或强制
删除。apply 失败后只重跑 report，依据新的 GitOps/registry 状态重新生成计划。

## 未采用方案

- **按无 tag 或年龄直接删除**：规则简单，但会误删受保护 OCI root 的 child manifest 或 referrer。
- **让既有发布脚本顺带清理**：可以复用发布入口，但它不拥有 inventory、删除权限或历史包分类。
- **等待构建自然结束后清理**：无需取消权限，但会继续消耗已关闭 PR 的构建资源；选择取消并确认终态。
- **关闭事件只触发并发取消**：改动较少，但独立清理任务无法确认构建何时停止，不能保证删除顺序。

## 后果

保留窗口之外的候选仍须通过 manifest graph 校验；full report/apply 与发布共享 mutation concurrency，
PR 关闭路径使用独立 per-PR 组，apply 后确认目标包消失。清理不承担集群操作、数据库迁移或源码目录退役。

### 重新评估与删除条件

以下任一条件成立时重新评估 10 个 release、90 天宽限期或退役 allowlist：发布/回滚窗口扩大，新增
production 或其他 GitOps 环境，BuildKit cache tag 改变，历史包重新进入 workload/GitOps，或
GitHub Packages 删除权限/接口行为改变。PR 缓存写入 owner 或 workflow 名称变化时，也须同步调整
取消与状态检查；停止写入 PR 缓存时移除该协调逻辑和 Actions 写权限。源码目录只有在其本地测试和合同同时移除后才可另行删除；
GHCR package 退役不自动删除仍被本地测试或开发数据库使用的 migration 代码。

## 相关文档

- [GHCR 镜像保留与清理](../../../../docs/runbooks/release/ghcr-retention.md)
- [运行时发布架构](../../../../docs/architecture/system/runtime-release.md)
- [Staging 版本选择](./2026-07-25-promotion.md)
