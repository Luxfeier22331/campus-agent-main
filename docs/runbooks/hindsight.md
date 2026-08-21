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
第二套配置投影。Bank Config API 只管理 bank 行为，不会热更新这些 provider 设置。

## Bank 配置

写入操作发现 scoped bank 不存在时创建并配置：

- observations 已启用；
- automatic consolidation 已启用；
- Memory Defense 对敏感数据使用 redaction；
- 没有仓库自定义 `observations_mission`。

已存在的 bank 不在每次操作中重复配置。recall 只读取已有 bank；bank 不存在时返回 no-match，
不会因读取请求创建 bank。bootstrap 失败时本次写入失败。

## 环境验证边界

本文不定义部署环境的产品冒烟流程。任务明确包含环境验证时，由环境仓和运行负责人按实际部署入口、
认证方式和数据选择检查，并将结果记录在对应发布或故障事项。`/readyz` 只能证明服务就绪，不能替代
个人记忆业务路径验证。

## 会话来源删除

会话裁剪或删除必须在删除产品消息前捕获消息 ID，并派生与 retain 相同的确定性文档标识。删除按
实现约束的有界批次执行；不存在的文档视为幂等成功。精确标识格式以个人记忆架构与实现为准。

`DeleteDocument` 成功会同步删除该来源文档及其 memory units。后续 consolidation 属于 Hindsight
内部维护，不由仓库轮询；可使用不会引入新来源的查询辅助排查，但不得建立自定义等待或恢复流程。

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
| item 长期 `saving`/`deleting` | app-api outbox、execution-control command admission 和 receipt callback |
| 账号长期 `erasing` | 代次租约、retired bank 删除和 receipt callback |
| 已删来源仍被 recall | document identity 是否一致、DeleteDocument 结果和 Hindsight 内部状态 |
| Axiom 出现记忆正文 | 立即按 OpenTelemetry 手册检查入口、容器日志排除和路由 |

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
