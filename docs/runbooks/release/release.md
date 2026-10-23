---
doc_type: runbook
owner_boundary: runtime-release
status: active
---

# 发布

## 边界

本文说明源码候选物如何交给环境仓并进入已配置的目标环境。分支协作见
[贡献指南](../../../.github/CONTRIBUTING.md)，证据选择见 [测试与验证](../../reference/verification.md)，环境部署和恢复命令由
环境仓操作手册维护。

## 发布链

```text
main 中已验证的源码
-> 带完整源码身份的不可变候选物
-> GitOps 组装完整 candidate
-> Kargo 选择、合并 PR 并协调执行 action
-> Argo CD/Terraform 应用期望状态
```

源码仓负责构建、检查并发布镜像和完整 Source candidate；GitOps 按目标环境构建 Worker bundle。镜像内容
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
可以执行 `cacheonly` 的 `linux/arm64` build-only 证据，不发布运行镜像或加载本地镜像。同仓 PR 的
独立镜像 job 只读取主线 canonical 缓存，不提供 PR cache 导出输入；fork 和 Dependabot 不使用
认证缓存，因此没有需要清理的 PR 缓存包。
主线发布仍只读写 canonical 缓存。特殊制品和手动
验证入口只有在明确选择时运行，不提供隐式全量发布或全量验证开关。

Source 的最新完整 OCI candidate 是累计 diff 基线。未变化的镜像、base 和 Worker source identity
继承上一份快照；首次发布构建完整集合。交接使用 digest，`latest` 仅用于发现基线。
计划不改变任何部署内容时，workflow 在计划后成功结束，不发布候选也不派发 GitOps。
GitOps 使用 `publish-source.yml` 组装 Worker candidate；`refresh_worker` 可刷新指定 Worker 或全部。
交接失败后用同一 OCI candidate_ref 重新组装，候选构建与 Kargo 发布互相独立。

首次发布会创建 `campus-agent/source-candidate` package。package owner 需要在其 Settings 的
Manage Actions access 中为 `campus-agent-gitops` 仓库授予 Read，允许 GitOps 的 `GITHUB_TOKEN`
读取私有快照；workflow 的 `packages` 权限和 promoter App 权限不替代这项跨仓授权。
如果首次组装因尚未授权而失败，授权后在 GitOps `publish-source.yml` 传入同一 digest 的
`candidate_ref` 重跑，无需重建 Source 镜像或将 package 改为公开。

Kargo 为候选创建选版 PR，等待分支检查、Argo 健康与 Worker 流量。失败 action 先在 GitHub 重跑，
再重试对应 Promotion。旧 Source run ID recovery、七天 artifact 交接和滚动 promotion PR 已退役。

## 正式版本

先合并 GitOps 的版本工具，再合并 Source workflow。首次使用前，由仓库维护者启用 Source
GitHub Immutable Releases；发布入口检查设置，未开启就失败。正式发布 job 的默认 `GITHUB_TOKEN` 只读；发布使用
单独限制到 Source 的 App token（contents write、workflows write），并使用 packages read 读取已选镜像。检查
immutable 设置使用另一个仅有 Source administration read 的 App token，不拥有 settings 写权限。GitOps 选择入口按
操作签发最小 App token：plan 只读，pause/select/retire/resume 按操作写 contents 或 pull requests；Source 读取正式版本或 dispatch 恢复也使用对应的只读或 actions write token。第一方 GHCR package 的
Actions access 必须允许这些 job 读取。权限由现有 promoter App 与 package owner 配置，不自动扩大。

1. 找到 GitOps 中 `environment=staging`、`task=release`、owner 为 `staging-release` 且完整成功的
   Deployment ID。不要使用候选构建或单个 Application 成功记录代替。
2. 在 Source `main` 运行 `formal-release.yml`，填写版本（首次 `v0.1.0`）和
   `gitops_deployment_id`。功能或破坏性变化递增 minor，兼容修复递增 patch。
3. 工具按精确 GitOps revision 导出完整组合，检查镜像、schema producer 和原生 Worker 可用性，
   创建 draft、上传 `release.json` 后发布。没有镜像构建或 Worker 上传步骤。
4. 中断后用相同输入重跑：匹配的 draft 继续，已发布相同内容成功返回；不同内容拒绝，不覆盖资产。
5. 版本选择、兼容性评审、回滚和退役使用 GitOps `formal-release-selection` workflow；具体命令见
   环境仓交付手册。选择 PR 不等于实际部署完成，仍等待其 Deployment 完整成功。

`release.json` 是完整应用组合及验证来源，不是历史环境备份。普通 SHA 构建不自动成为正式版本。
正式版本仍受 Cloudflare 原生回滚窗口限制；版本不可用时正常选择失败，不重建原 Worker。

## 环境交接

Kargo 从 candidate 与当前 main 计算版本变化，并拒绝基于过期游标覆盖已经前进的环境状态。机器版本变更只修改
环境策略允许的不可变版本字段；Secret、权限、资源、网络、Terraform、workflow、Application 拓扑和
目标环境选择必须使用普通受审变更。

交接前确认：

- 所有候选物来自同一预期源码身份并使用不可变引用；
- 数据库结构、角色、Secret 和 workload 的先后关系完整；
- 渲染结果和策略检查只包含预期资源；
- 回滚目标及其依赖仍可取得。

合并后等待环境仓定义的 reconcile、migration、rollout 和 readiness。不得绕过环境仓直接修改集群、
流量或线上 Secret。

涉及 Agent Control schema/role 或配置合同切换时，环境仓必须先完成新 Secret/ConfigMap 合同和旧消费者
排空，再执行 schema migration 与新消费者 rollout。源码 promotion 不会自动重命名 SealedSecret、ConfigMap
或 key；具体的暂停、排空、迁移、验证和旧 role 退役顺序以[执行服务运维](../runtime/execution.md)为准。

## 个人记忆召回合同切换

将记忆上下文格式化移入 Runtime 后，内部 recall 从 `{outcome, memory_text}` 改为
`{facts, context_char_budget}`，工具注册表 fingerprint 随之改变。Runtime 消费 Memory 返回的 facts 和预算，
再生成模型上下文；Control 负责终态后的追加投递，Memory API/Worker 负责独立命令和 Hindsight 操作。
模型工具结果和产品接口维持原合同；不提供新旧传输的双解析。只协调受影响合同的 agent-control、agent-runtime
和 Memory API/Worker：

1. 不兼容切换时，由环境仓暂停受影响的新聊天、记忆命令准入与定时派发，保留现有服务及恢复路径供在途执行收敛。
2. 等待 AgentWorkflow、Control 待投递的终态追加、Memory 命令/Workflow、Hindsight operation 和
   对应 lease 收敛。回答完成或 HTTP active requests 为零都不代表 Memory 已排空；未知 operation 或未释放
   lease 按既有恢复流程处理，不能通过删除 lease、清空 namespace 或 bank 宣告排空。
3. 停止旧版本消费者，通过环境仓将受影响服务切到兼容合同的候选组合；确认旧进程退出后再恢复
   准入。各服务 release 值仍用于诊断，不代替 fingerprint 检查。
4. 用已准入的 recall 验证空结果与命中、模型工具输出和回答后追加，再恢复定时派发。
5. 需要回退时重新暂停相关准入并排空，按受影响合同部署兼容的 Control、Runtime、Memory 组合；不能只回退一端。

召回格式切换不要求复制或清空 Memory 数据、Hindsight bank、owner salt、generation 或追加身份；
如候选物包含 schema 变更，由对应数据库 owner 的发布迁移处理。当前不再使用原 agent-control Go Worker 或
`memory.append/<request_id>` Workflow。这里定义环境切换步骤；源码检查通过不表示实际环境已经切换。

## 失败处理

- 候选物发布中断：对同一源码身份重试缺失步骤，不覆盖已有不可变产物；
- 环境交接失败：重新读取环境当前状态并解决游标或策略冲突，不强制覆盖；
- migration、rollout 或 readiness 失败：使用环境仓定义的恢复路径回到已知版本；
- 外部平台失败：保留原始退出状态和脱敏诊断，不切换未批准凭据或伪装成功。

任何恢复都不能改用可变标签、绕过环境仓，或把健康检查成功当成环境交接已经完成。

## 相关文档

- [运行时发布架构](../../architecture/system/runtime-release.md)
- [GitOps](../../../.agents/notes/implemented/process/2026-07-16-gitops.md)
- [源码仓库与环境仓库边界](../../../.agents/notes/implemented/process/2026-07-16-repository-boundary.md)
- [Staging 版本选择](../../../.agents/notes/implemented/process/2026-07-25-promotion.md)
