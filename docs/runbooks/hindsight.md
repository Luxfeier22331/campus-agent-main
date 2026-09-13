---
doc_type: runbook
owner_boundary: docs/runbooks
status: active
---

# Hindsight 个人记忆运维

## 边界

本文只说明如何检查和排查 campus-agent 对 Hindsight 的使用。组件关系和生命周期见
[个人记忆架构](../architecture/system/memory-plane.md)；环境资源、Secret、Helm values、备份和恢复
由环境仓维护。

## 配置检查

1. 从当前镜像和 Go client pin 确认预期版本，再访问 Hindsight `/version`；不要在 runbook 中
   维护第二份固定版本。
2. 确认 execution-control 获得 Hindsight base URL、tenant API secret 和稳定用户派生 salt；变量
   所有权见 [Provider 与模型配置](../environment/providers.md)。
3. 确认 Hindsight 自身的 PostgreSQL、LLM、embedding 和 reranker 配置由环境仓 Helm values
   提供，未从 app-api、Ops Web 或 execution-control 在线模型配置派生。
4. `/readyz` 不调用 Hindsight，也不能替代业务路径验证；需要业务路径证据时，由环境所有者按需
   选择实际入口执行。

源码配置存在只证明仓库合同，不证明某个环境已部署或可用。

Hindsight 在服务启动时读取 LLM、Embedding 和 Rerank 配置。模型 endpoint、model 或 key
变化时修改环境仓拥有的 Helm values/Secret，并由 Argo CD 更新工作负载。源码仓与 Ops Web 不维护
第二套配置投影。Bank Config API 只管理 bank 行为，不会热更新这些 provider 设置。\n\n网关拒绝 SDK 请求但相同认证的普通 HTTP 请求成功时，对照客户端请求头与网关规则。\nHindsight 支持 `HINDSIGHT_API_LLM_DEFAULT_HEADERS`，本地 Compose 可透传；仅在确认需要时\n配置明确的组件 User-Agent。不要把 HTTP 403 当作模型不存在或盲目重试。

## Bank 配置

写入操作发现 scoped bank 不存在时创建并配置：

- observations 已启用；
- automatic consolidation 已启用；
- Memory Defense 对敏感数据使用 redaction；
- 没有仓库自定义 `observations_mission`。

已存在的 bank 不在每次操作中重复配置。recall 只读取已有 bank；bank 不存在时返回 no-match，
不会因读取请求创建 bank。bootstrap 失败时本次写入失败。

## 本地业务验证

先在目标 worktree 执行 `pnpm dev:init -- --target core`，使用初始化账号登录，不另行注册。
Hindsight 使用隔离的本地 PostgreSQL 和 bank salt；provider 端点/密钥独立注入，不复制 staging 的
Hindsight 数据库。端口取当前 dev profile。按本手册配置启动后访问
`/account/settings/memory`：

1. 添加一段自然语言偏好，等待管理命令完成，确认列表读到 Hindsight 实际事实，而非本地输入镜像。
2. 编辑、停用、恢复该事实；活动/停用筛选分别显示真实状态。派生观察只读，从支持事实进入详情管理。
3. 新建会话陈述个人偏好，等回答与后台追加完成，再新建会话询问该偏好；检查实际 recall 和回答。
4. 删除原会话或裁剪消息，确认已有记忆仍在，不产生来源删除命令。
5. 暂停 Hindsight 时，设置仍可读，内容区显示依赖错误；无关普通回答可完成。恢复后使用显式重试。
6. 确认清除全部记忆，等待 erased，检查 bank 不存在且开关保持关闭；原聊天记录仍在，
   再次启用不会重新导入历史会话。

Ops 请求页观察 memory.append 从 pending/running 到 completed、skipped 或 failed。
回答完成不等于后台记忆完成；单次失败看 attempt，整体重试终态看 step，不以固定等待秒数判断成功。

## 原生内容适配

列表接口返回 `fact_type`，详情及支持事实返回 `type`。不要用只有空列表的测试验证适配。
支持事实摘要不一定带有 state/metadata；页面进入该事实详情后再展示和操作当前状态。

手工记忆与会话追加都明确标记为当前用户的陈述，第一人称不能解释成助手自身。
修改事实后派生观察由 Hindsight 原生 consolidation 更新，不由应用手工改写。

## 个人记忆硬切

仅对已经接受硬切的本地/staging 数据执行；正式发布走环境仓流程。旧版本不能直接回滚到已迁移 schema。

1. 核对 namespace、实例数据库、稳定 owner salt 和实际版本。只列出本环境个人记忆 bank、
   `PersonalMemoryCommandWorkflow` 及尚未完成的 `memory.append`。
2. 暂停该环境的新聊天/记忆写入与定时派发，等待在途聊天完成。停止旧个人记忆工作流时使用具体 ID；
   不清空 Temporal namespace。确认没有旧调用继续写入后再清除 bank。
3. 对列明的产品 bank 调用原生 DeleteBank，确认不存在。包括失败擦除留下的旧代次 bank；
   不删除 Hindsight 的整个数据库、其他应用 bank 或共享对象存储。
4. 按现有 schema job 应用 `0013_personal_memory_management.sql`。此迁移移除旧条目镜像、
   来源删除表、旧命令正文及聊天调用序号，并把已有设置标为 erased；保留账户、聊天、通知及 RAG。
5. settings 的 generation/command_sequence 不归零。在已清除 bank 且无在途调用后，对对应 owner
   的 runtime fence 同步为 erased，保持当前 generation 和最后命令序号；移除这些 owner 的旧
   call leases/command receipts。不能留下 erasing fence，也不能让旧 receipt 阻塞新代次命令。
6. 同批发布 App API、Campus Web、Execution Control 和 Ops Web，恢复流量，重复上面的业务验证。
   Hindsight 使用支持 curation 的相同版本；恢复开关只新建后续需要的 bank，不导入历史消息。

会话删除、批量删除和裁剪均不清除记忆，不捕获 message ID，也不投递来源删除命令。

## 账号全量清除

账号全量清除是账户级删除，不是单次会话回滚：

1. app-api 接受 durable command 并进入 `erasing`；
2. execution-control 递增 generation，拒绝 retired generation 的新调用并等待旧调用排空；
3. 删除 retired Hindsight bank，并验证 bank 不存在；
4. bank 不存在后完成 receipt，app-api 才允许 lifecycle 进入 `erased`。

## 排障

| 现象 | 检查 |
| --- | --- |
| `/version` 或 health 失败 | 服务地址、tenant API secret、网络和实际镜像版本 |
| bank bootstrap 失败 | observations、consolidation、Memory Defense 配置和 provider 可用性 |
| recall/append timeout | recall 对应 Agent Activity 与 SDK tool attempt；append 对应 core Activity；同时检查 Hindsight provider latency 和 worker backlog |
| 普通管理命令长期 pending/admitted | app-api profile-memory command outbox、execution-control command admission 和 receipt callback |
| 账号长期 `erasing` | 代次租约、retired bank 删除和 receipt callback |
| 已停用事实仍被 recall | 原生 state、派生观察及其支持事实；不把“停用”解释成物理删除 |
| 外部观测平台出现记忆正文 | 立即停止对应 producer，并按 Langfuse 字段合同检查清理边界 |

Hindsight 后台 operation 使用其原生诊断能力排查；不要在 campus-agent 增加 operation
status/list/cancel/retry API 或 reconciliation schedule。

## 仓库验证

```bash
go -C apps/execution-control test ./internal/httpapi ./internal/temporalruntime ./internal/telemetry
scripts/otel/validate-config.sh
```

这些检查验证 adapter、workflow 和 Collector 配置，不证明外部环境已收到数据。

OpenTelemetry 配置和信号验证统一见 [OpenTelemetry Collector](./otel.md) 与
[Langfuse 运行合同](../contracts/langfuse-runtime.md)，不在本手册复制入口、属性和路由清单。

## 官方资料

- [Hindsight Monitoring](https://hindsight.vectorize.io/developer/monitoring)
- [Hindsight Retain](https://hindsight.vectorize.io/developer/api/retain)
- [Hindsight Documents](https://hindsight.vectorize.io/developer/api/documents)
- [Hindsight Operations](https://hindsight.vectorize.io/developer/api/operations)
- [Hindsight Memory Defense](https://hindsight.vectorize.io/developer/memory-defense)
