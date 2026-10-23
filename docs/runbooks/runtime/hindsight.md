---
doc_type: runbook
owner_boundary: apps/memory-service
status: active
---

# Hindsight 个人记忆运维

## 边界

本文只说明如何检查和排查 campus-agent 对 Hindsight 的使用。组件关系和生命周期见
[个人记忆架构](../../architecture/system/memory-plane.md)；环境资源、Secret、Helm values、备份和恢复
由环境仓维护。

## 配置检查

1. 从当前镜像和 Go client pin 确认预期版本，再访问 Hindsight `/version`；不要在 runbook 中
   维护第二份固定版本。
2. 确认 Memory API 与 Worker 获得 Hindsight base URL、tenant API secret 和稳定用户派生 salt；变量
   所有权见 [Provider 与模型配置](../../environment/providers.md)。
3. 确认 Hindsight 自身的 PostgreSQL、LLM、embedding 和 reranker 配置由环境仓 Helm values
   提供，未从 app-api、Ops Web 或 agent-control 在线模型配置派生。
4. `/readyz` 不调用 Hindsight，也不能替代业务路径验证；需要业务路径证据时，由环境所有者按需
   选择实际入口执行。

源码配置存在只证明仓库合同，不证明某个环境已部署或可用。

Hindsight 在服务启动时读取 LLM、Embedding 和 Rerank 配置。模型 endpoint、model 或 key
变化时修改环境仓拥有的 Helm values/Secret，并由 Argo CD 更新工作负载。源码仓与 Ops Web 不维护
第二套配置投影。Bank Config API 只管理 bank 行为，不会热更新这些 provider 设置。

网关拒绝 SDK 请求但相同认证的普通 HTTP 请求成功时，对照客户端请求头与网关规则。Hindsight 支持
`HINDSIGHT_API_LLM_DEFAULT_HEADERS`，本地 Compose 可透传；仅在确认需要时配置明确的组件 User-Agent。
不要把 HTTP 403 当作模型不存在或盲目重试。

## Bank 配置

写入操作发现 scoped bank 不存在时创建并配置：

- observations 已启用；
- automatic consolidation 已启用；
- Memory Defense 对敏感数据使用 redaction；
- 没有仓库自定义 `observations_mission`。

已存在的 bank 不在每次操作中重复配置。recall 只读取已有 bank；bank 不存在时返回 no-match，
不会因读取请求创建 bank。bootstrap 失败时本次写入失败。

## 本地业务验证

先在目标 worktree 执行 `pnpm dev:init -- --target core`，配置 Hindsight provider 后显式运行
`pnpm dev:local -- infra --service hindsight`；使用初始化账号登录，不另行注册。
core 初始化生成并复用 tenant key 和 bank salt，向 memory-service 写入连接配置；
显式 `infra --service hindsight` 启动当前 Compose project 的 Hindsight 与独立 PostgreSQL，端口取当前 dev profile。启动前在根 `.env`
独立配置 `HINDSIGHT_API_LLM_API_KEY`、`HINDSIGHT_API_LLM_BASE_URL`、`HINDSIGHT_API_LLM_MODEL`、
`HINDSIGHT_API_LLM_PROVIDER` 及 `HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY`、
`HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL`、`HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL`。
使用 Responses 网关时设置 `HINDSIGHT_API_LLM_PROVIDER=openai-responses`，base URL 指向其 `/v1`；
Hindsight 0.9.1 的 Gemini provider 不使用此 base URL，不能直接用它连接 Gemini 代理网关。
已有明确的 Hindsight provider 配置可从主 checkout 导入；不复制 staging 数据库。
`dev:doctor` 检查该依赖，`dev:destroy` 随当前 project 清理其容器和数据卷。启动应用后访问
`/account/settings/memory`：

1. 提交一段自然语言纠正，等待命令完成与画像刷新，确认画像内容来自 Hindsight 实际合成，而非本地输入镜像。
2. 新建会话陈述个人偏好，等回答与后台追加完成，再新建会话询问该偏好；检查实际 recall 和回答。
3. 删除原会话或裁剪消息，确认已有记忆仍在，不产生来源删除命令。
4. 暂停 Hindsight 时，设置仍可读，画像区显示依赖错误；无关普通回答可完成。恢复后使用显式重试。
5. 确认清除全部记忆，等待 erased，检查 bank 不存在且开关保持关闭；原聊天记录仍在，
   再次启用不会重新导入历史会话。

回答完成后先确认 Control 的 Memory 投递已被接收，再检查 Memory 操作的执行状态。
新路径不创建 Ops 的 `memory.append` 步骤；回答完成或投递成功都不等于记忆处理完成。
追加故障由 Memory Worker 与自有数据库定位，不以固定等待秒数判断成功。

## 原生内容适配

手工纠正与会话追加都明确标记为当前用户的陈述，第一人称不能解释成助手自身。画像内容由
Hindsight `user-profile` mental model 原生合成；派生内容由 Hindsight consolidation 更新，不由应用
手工改写。逐条 item list/get wire 适配已随 staging 清理删除。

## 账号全量清除

App API 协调账户级删除：先由 agent-control 建立 owner deletion fence 并取消、排空活动 run，
再调用 Memory API 完成 erase 与 tombstone，随后清理 Control 投影和产品数据。
Memory 拥有 generation fence、调用租约及 retired Hindsight bank 的删除与确认；
Control 不直接操作 Hindsight。单独清除个人记忆通过产品记忆命令执行，不删除聊天记录。
具体流程见[个人记忆架构](../../architecture/system/memory-plane.md)与
[账号合同](../../contracts/app-api/auth.md)。

## 排障

| 现象 | 检查 |
| --- | --- |
| `/version` 或 health 失败 | 服务地址、tenant API secret、网络和实际镜像版本 |
| bank bootstrap 失败 | observations、consolidation、Memory Defense 配置和 provider 可用性 |
| recall/append timeout | recall 对应 Agent Runtime 工具 Activity；append 对应 Memory Worker；同时检查 Hindsight provider latency 和 worker backlog |
| 记忆命令长期 pending/admitted | app-api 命令投递、Memory API 命令接收、Memory Worker 和 receipt callback |
| 清除长期未完成 | 代次租约、retired bank 删除和 receipt callback |
| 画像与用户纠正不符 | 纠正命令 receipt、`user-profile` mental model 刷新（`refresh_after_consolidation`）和 consolidation 进度 |
| 外部观测平台出现记忆正文 | 立即停止对应 producer，并按 Langfuse 字段合同检查清理边界 |

Hindsight 后台 operation 使用其原生诊断能力排查；不要在 campus-agent 增加 operation
status/list/cancel/retry API 或 reconciliation schedule。

## 仓库验证

```bash
go -C apps/memory-service test ./...
```

这些检查验证 adapter、workflow 和 telemetry 配置，不证明外部环境已收到数据。

Agent trace 信号验证见 [Langfuse 运行合同](../../contracts/langfuse-runtime.md)，不在本手册复制入口、属性和路由清单。

## 相关文档

- [个人记忆架构](../../architecture/system/memory-plane.md)
- [Langfuse 运行合同](../../contracts/langfuse-runtime.md)
- [Provider 与模型配置](../../environment/providers.md)

## 官方资料

- [Hindsight Monitoring](https://hindsight.vectorize.io/developer/monitoring)
- [Hindsight Retain](https://hindsight.vectorize.io/developer/api/retain)
- [Hindsight Documents](https://hindsight.vectorize.io/developer/api/documents)
- [Hindsight Operations](https://hindsight.vectorize.io/developer/api/operations)
- [Hindsight Memory Defense](https://hindsight.vectorize.io/developer/memory-defense)
