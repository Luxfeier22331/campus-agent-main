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
可以执行 `cacheonly` 的 `linux/arm64` build-only 证据，不发布运行镜像或加载本地镜像。同仓 PR 的
独立镜像 job 只读取主线 canonical 缓存，不提供 PR cache 导出输入；fork 和 Dependabot 不使用
认证缓存。历史 PR cache 通过[手动清理入口](./ghcr-retention.md)处理。
主线发布仍只读写 canonical 缓存。特殊制品和手动
验证入口只有在明确选择时运行，不提供隐式全量发布或全量验证开关。

同 SHA 的重复自动 push 在写 pending 前检查既有 workflow jobs：发布及 Source promotion 已完成
时直接跳过；制品已完整发布但状态收尾或 promotion 失败时，验证现有 artifact 并复用，不重新构建
或上传。复用后按当前累计计划筛选制品，继续交给 GitOps。`topology-required` 仍表示需要先修复
环境拓扑，不表示完成交接或部署；重复自动事件可复用候选再尝试，也可在修复后用显式 recovery 继续。

artifact 过期或不完整时失败并指向手动入口，不自动重建。显式 `workflow_dispatch` 不受自动去重
限制；配置刷新使用 `candidate_scope=app-api-config`。App API staging 上传只允许在 GitHub Actions
执行，在本地运行会在 preflight 和配置读取前失败。显式 promotion recovery 同时填写原始发布 run ID
和 Source SHA，缺少任一项都会在查询远端状态或写入候选状态前失败。
恢复使用原始 Worker artifact 中的候选，保留 `app-api-config` 与 `campus-web-docs` 的同 SHA 刷新
结果；`candidate_scope` 使用默认 `affected` 即可，不必重新选择刷新入口，也不会重新上传 Worker。
当前累计计划需要的其他制品仍须完整可用；真实发布失败仍可以重跑发布。

## 正式版本

先合并 GitOps 的版本工具，再合并 Source workflow。首次使用前，由仓库维护者启用 Source
GitHub Immutable Releases；发布入口检查设置，未开启就失败。正式发布 job 的默认 `GITHUB_TOKEN` 只读；发布使用
单独限制到 Source 的 App token（contents write、workflows write），并使用 packages read 读取已选镜像。检查
immutable 设置使用另一个仅有 Source administration read 的 App token，不拥有 settings 写权限。GitOps 选择入口按
操作签发最小 App token：plan 只读，select/retire 才写 contents 与 pull requests，resume 才写 actions 并读取
部署状态；Source 读取正式版本或 dispatch 恢复也使用对应的只读或 actions write token。第一方 GHCR package 的
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

## 个人记忆召回合同切换

将记忆上下文格式化移入 Runtime 后，内部 recall 从 `{outcome, memory_text}` 改为
`{facts, context_char_budget}`，工具注册表 fingerprint 随之改变。模型工具结果和产品接口维持原合同；
不提供新旧传输的双解析。按现有维护窗口协同切换 execution API、execution Worker 和 agent-runtime：

1. 由环境仓暂停新聊天、记忆命令准入与定时派发，保留现有依赖供在途执行收敛。
2. 等待回答 workflow、独立 `memory.append/<request_id>`、个人记忆命令 workflow 和对应 Hindsight
   operation 收敛。回答完成或 HTTP active requests 为零都不代表追加已结束；未知 operation 或未释放
   lease 按既有恢复流程处理，不能通过删除 lease、清空 namespace 或 bank 宣告排空。
3. 停止旧版本消费者，将 API、Worker、Runtime 切到同一工具合同的候选组合；确认旧进程退出后再恢复
   准入。各服务 release 值仍用于诊断，不代替 fingerprint 检查。
4. 用已准入的 recall 验证空结果与命中、模型工具输出和回答后追加，再恢复定时派发。
5. 需要回退时重新暂停准入并排空，三个组件作为兼容组合回退；不能只回退一端。

本次不迁移数据库 schema、Hindsight bank、generation 或异步追加身份；旧同步追加与 replay
分支已在没有旧 workflow 的前提下删除。这里定义环境切换步骤；源码检查通过不表示实际环境已经切换。

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
