---
doc_type: runbook
owner_boundary: runtime-release
status: active
---

# 发布

## 边界

本文说明源码候选物如何交给环境仓并进入已配置的目标环境。分支协作见
[贡献指南](../../CONTRIBUTING.md)，证据选择见 [测试与验证](../reference/verification.md)，环境部署和恢复命令由
环境仓操作手册维护。

## 发布链

```text
main 中已验证的源码
-> 带完整源码身份的不可变候选物
-> 环境仓选择候选物
-> 环境控制器应用期望状态
```

源码仓负责构建、检查并发布镜像候选物，以及按目标 Worker 配置生成的 Worker 版本候选物。镜像内容
可以跨环境复用，Worker 候选物对应具体目标 Worker。环境仓负责地址、Secret、权限、网络、资源、环境
配置和实际版本选择。候选物、源码 workflow 或环境变更 PR 存在都不表示环境已经部署。

## 候选物

1. 确认目标源码已经合入 `main`，并具有本次变化要求的源码证据。
2. 按可执行发布配置选择受影响制品；触发条件、输入、产物和超时以源码 workflow、构建定义和发布
   适配器为准。
3. 为每个候选物记录精确 Source SHA、不可变版本或 digest、构建身份和必要 metadata。
4. 重试同一源码版本时复用已经验证的不可变产物，只补齐缺失步骤；不得用可变标签覆盖已有产物。
5. 所有被选候选物成功后，才把同一源码身份交给环境仓；不创建缺少已选制品的部分提升。

普通 PR 不发布最终候选物，也不访问私有环境、供应商状态、集群或真实私有数据。涉及镜像的 PR
可以执行 `cacheonly` 的 `linux/arm64` build-only 证据，不发布运行镜像或加载本地镜像。同仓非 Dependabot
PR 的独立镜像 job 可以读取 PR 和主线缓存，并写入该 PR 的 `pr-cache-<number>` 命名空间；fork 和
Dependabot job 不进行认证缓存读写。主线发布仍只读写 canonical 缓存。特殊制品和手动
验证入口只有在明确选择时运行，不提供隐式全量发布或全量验证开关。

## 环境交接

环境仓从自身当前选择计算版本变化，并拒绝基于过期游标覆盖已经前进的环境状态。机器版本变更只修改
环境策略允许的不可变版本字段；Secret、权限、资源、网络、Terraform、workflow、Application 拓扑和
目标环境选择必须使用普通受审变更。

交接前确认：

- 所有候选物来自同一预期源码身份并使用不可变引用；
- 数据库结构、角色、Secret 和 workload 的先后关系完整；
- 渲染结果和策略检查只包含预期资源；
- 回滚目标及其依赖仍可取得。

合并后等待环境仓定义的 reconcile、migration、rollout 和 readiness。不得绕过环境仓直接修改集群、
流量或线上 Secret。

## 失败处理

- 候选物发布中断：对同一源码身份重试缺失步骤，不覆盖已有不可变产物；
- 环境交接失败：重新读取环境当前状态并解决游标或策略冲突，不强制覆盖；
- migration、rollout 或 readiness 失败：使用环境仓定义的恢复路径回到已知版本；
- 外部平台失败：保留原始退出状态和脱敏诊断，不切换未批准凭据或伪装成功。

任何恢复都不能改用可变标签、绕过环境仓，或把健康检查成功当成环境交接已经完成。

## 相关文档

- [运行时发布架构](../architecture/system/runtime-release.md)
- [ADR-0065 GitOps](../../.agents/notes/implemented/process/2026-07-16-adr-0065-gitops.md)
- [ADR-0074 源码仓库与环境仓库边界](../../.agents/notes/implemented/process/2026-07-16-adr-0074-repository-boundary.md)
- [ADR-0083 Staging 版本选择](../../.agents/notes/implemented/process/2026-07-25-adr-0083-promotion.md)
