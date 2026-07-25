---
doc_type: runbook
owner_boundary: docs/runbooks
status: active
---

# Hindsight 个人记忆运维

## 边界

本文只说明如何检查和排查 campus-agent 对 Hindsight 的使用。组件关系和生命周期见
[个人记忆架构](../architecture/system/memory-plane.md)，调用链边界见
[Langfuse 架构](../architecture/system/langfuse.md)；环境资源、Secret、Helm values、备份和恢复
由环境仓维护。

## 配置检查

1. 从当前镜像和 Go client pin 确认预期版本，再访问 Hindsight `/version`；不要在 runbook 中
   维护第二份固定版本。
2. 确认 execution-control 获得 Hindsight base URL、tenant API secret 和稳定用户派生 salt；变量
   所有权见 [Provider 与模型配置](../environment/providers.md)。
3. 确认 Hindsight 自身的 PostgreSQL、LLM、embedding 和 reranker 配置由其部署所有者提供，未从
   app-api 投影或 execution-control 在线模型配置派生。
4. 通过 Ops Web 读取固定 `hindsight-model-config` 与 `hindsight-api` Deployment 的派生状态。
   如果 Secret 中的固定 provider、embedding model/provider 或 reranker provider 与合同不符，
   `configState` 应为 `drifted`，先保存配置修复固定键。保存模型设置后 `applyState` 应为 `pending`，
   显式应用后再按 `applyState` 和 `runtimeState` 判断结果：运行中应在 rollout 后变为
   `applied + running`；零副本应直接变为 `applied + scaled_down`，且不会自动扩容。`applied` 不表示
   模型供应商调用已经验证。
5. 确认 execution-control health check 能访问 Hindsight，且失败时不会启用 Qdrant、PostgreSQL
   profile 注入或供应商抽取记忆。

源码配置存在只证明仓库合同，不证明某个环境已部署或可用。

Hindsight 0.8.x 在服务启动时读取 LLM、Embedding 和 Rerank 配置。模型 endpoint、model 或 key
变化后，运行实例必须通过 Deployment rollout 重新加载；零副本只需先更新 Pod template，实例下次
启动时读取目标配置。Bank Config API 只管理 bank 行为，不会热更新这些 provider 设置。

## Bank 配置

创建或修复 scoped bank 后，回读配置并确认：

- observations 已启用；
- automatic consolidation 已启用；
- Memory Defense 对敏感数据使用 redaction；
- 没有仓库自定义 `observations_mission`。

bootstrap 或 policy 校验失败时，本次 retain、recall、reflect 或 profile mutation 必须失败，不能
继续访问未满足 policy 的 bank。

## 功能冒烟

使用临时测试用户和可识别的合成文本，按产品接口验证完整路径：

1. GET 个人记忆，确认 lifecycle 和 sync status 可读。
2. 使用 `Idempotency-Key` 新增 item，确认返回 `202`、item 为 `saving`，随后 GET 收敛为
   `synced`。
3. 完成一轮聊天，确认 recall 在 Agent Activity 前执行，append 在 finalization 后同步 retain
   accepted user message。
4. pause 后发起新 turn，确认 recall 和 append 都投影 skipped；resume 后新 turn 恢复调用。
5. 删除 item，等待 sync 收敛后确认对应 profile document 不再通过 recall 返回。
6. 执行账号全量删除，确认状态先进入 `erasing`，在代次隔离、bank 删除和 Langfuse 删除检查
   点全部完成后才进入 `erased`。

不要用 HTTP `202`、Temporal Schedule 存在或 UI 隐藏代替最终状态检查。测试结束后删除临时账号
数据。

## 会话来源删除

会话裁剪或删除必须在删除产品消息前捕获消息 ID，并派生与 retain 相同的确定性文档标识。删除按
实现约束的有界批次执行；不存在的文档视为幂等成功。精确标识格式以个人记忆架构与实现为准。

删除完成后等待 Hindsight consolidation 生效，并使用不会引入新来源的查询确认已删除内容不再
被 recall。不得通过删除产品行、隐藏 UI 或创建新 bank 伪造来源删除成功。

## 账号全量清除

账号全量清除是账户级删除，不是单次会话回滚：

1. app-api 接受 durable command 并进入 `erasing`；
2. execution-control 递增 generation，拒绝 retired generation 的新调用并等待旧调用排空；
3. 删除 retired Hindsight bank，并验证 bank 不存在；
4. 旧 lease 排空且 bank 删除成功后等待 10 分钟，使 Collector 最长重试窗口结束；
5. 按 command 冻结的产品 user identity 与 `source_updated_at` 上界删除 runtime trace，并按
   retired bank identity 删除全部 Hindsight trace；每轮删除后等待 5 分钟再复核，最多五轮；
6. 两类查询均收敛为零后，receipt 才允许 app-api 进入 `erased`。

Langfuse 查询、分页、时间边界、等待和失败语义由
[Langfuse 运行合同](../contracts/langfuse-runtime.md) 唯一维护。

`activity-core` 使用 `LANGFUSE_MAINTENANCE_BASE_URL`、`LANGFUSE_MAINTENANCE_PUBLIC_KEY` 和
`LANGFUSE_MAINTENANCE_SECRET_KEY` 访问当前环境 project；缺少任一项时必须启动失败。DELETE
成功不代表异步删除完成，不能省略后续精确查询复核。

## 排障

| 现象 | 检查 |
| --- | --- |
| `/version` 或 health 失败 | 服务地址、tenant API secret、网络和实际镜像版本 |
| bank bootstrap 失败 | observations、consolidation、Memory Defense 配置和 provider 可用性 |
| recall/append timeout | Temporal activity attempt、Hindsight provider latency 和 worker backlog |
| item 长期 `saving`/`deleting` | app-api outbox、execution-control command admission 和 receipt callback |
| 账号长期 `erasing` | 代次租约、bank 删除、Langfuse 两类身份的删除与复核 |
| 已删来源仍被 recall | document identity 是否一致、删除结果和 consolidation 是否完成 |
| Langfuse 缺少 Hindsight trace | 按 OpenTelemetry 手册检查 Hindsight 发送、Collector 接收和导出 |
| Axiom 出现记忆正文 | 立即按 OpenTelemetry 手册检查入口、容器日志排除和路由 |

Hindsight 后台 operation 使用其原生诊断能力排查；不要在 campus-agent 增加 operation
status/list/cancel/retry API 或 reconciliation schedule。

## 仓库验证

```bash
go -C apps/execution-control test ./internal/httpapi ./internal/temporalruntime ./internal/telemetry
pnpm ci:otel
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
- [Langfuse OpenTelemetry](https://langfuse.com/integrations/native/opentelemetry)
- [Langfuse Data Deletion](https://langfuse.com/docs/data-deletion)
