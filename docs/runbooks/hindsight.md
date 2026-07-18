---
doc_type: runbook
owner_boundary: docs/runbooks
status: active
---

# Hindsight 个人记忆运维

## 运行合同

- Hindsight API/server 合同为 0.8.4；Go client 固定到已审查 commit，`/version` 是兼容性 gate。
- bank config 启用 observations、automatic consolidation 和 Memory Defense redaction，不设置
  `observations_mission`。
- retain 使用 `async=false`、`update_mode=replace` 和确定性 source document，只发送已接受的
  user message；assistant output 不进入长期记忆。
- recall 使用 private observation scope、`prefer_observations=true`，并只消费有界
  `experience`、`observation` 和 `world` 事实。
- Helm 0.8.4 保留 API embedded worker，`worker.enabled=false`，避免两个 consumer。
- Hindsight 后台 operation 不镜像到 campus-agent；不配置 webhook、operation polling 或
  reconciliation schedule。

## 部署顺序

1. 应用 app-api profile memory outbox migration 和 shared chat schema。
2. 安装 execution-control owner fence、call lease、command receipt 与 Langfuse trace maintenance
   配置。
3. 部署 Hindsight API、embedded worker、外部 PostgreSQL 与稳定 owner salt。
4. 部署 Collector Gateway 的 Hindsight trusted receiver，并路由到环境唯一的 Langfuse project。
5. 依次部署 execution-control、app-api 和 campus-web。
6. 确认 readiness 报告 Hindsight 与 memory state store 健康，再启用 profile-memory command
   sweeper。

源码 manifest、Secret 名称或 Helm render 不证明环境已经完成上述步骤。

## Bank 能力验证

bank 创建或修复后必须读取配置并确认：

- `enable_observations=true`；
- `enable_auto_consolidation=true`；
- Memory Defense 对 retain/recall/reflect 的敏感数据规则已启用；
- 没有仓库自定义 `observations_mission` 或 “track anything notable” prompt。

Hindsight 原生 observation 与 consolidation 管理长期记忆提炼。仓库只提供权威用户来源、scope
和删除合同，不建立第二套 notable-memory prompt 或 operation scheduler。

## Trace 链路

execution-control 调用 Hindsight 时传播 W3C `traceparent` 与 `baggage`。HTTP transport 为每次
调用创建 `memory.call` client span，只允许：

- `memory.provider=hindsight`
- `http.request.method`

不得加入 URL、bank ID、document ID、operation ID、请求正文或响应正文。Hindsight 的原生 OTel
trace 使用独立 trusted receiver，进入环境唯一的 Langfuse project；
`HINDSIGHT_API_LLM_TRACE_ENABLED` 保持关闭，避免与通用 OTel trace 重复。

Collector 将 Hindsight 的 bank 标识原样映射为 `langfuse.user.id` 后删除源属性。该标识已经由
execution-control 使用 owner salt、tenant、user 和 generation 派生，不得在 Collector 或
Langfuse 侧再次加盐，否则 owner erase 无法定位相同 trace。

典型非敏感配置合同：

```text
HINDSIGHT_API_LLM_TRACE_ENABLED=false
HINDSIGHT_API_LLM_PROVIDER=openai
HINDSIGHT_API_LLM_MODEL=gpt-5.6-luna
HINDSIGHT_API_LLM_BASE_URL=https://gateway.mucwiki-edge.link/v1
HINDSIGHT_API_EMBEDDINGS_PROVIDER=openai
HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL=https://ai.gitee.com/v1
HINDSIGHT_API_RETAIN_EXTRACTION_MODE=chunks
HINDSIGHT_API_OTEL_TRACES_ENABLED=true
HINDSIGHT_API_OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4321
HINDSIGHT_API_OTEL_SERVICE_NAME=hindsight-api
HINDSIGHT_API_ACCESS_LOG=false
HINDSIGHT_API_AUDIT_LOG_ENABLED=false
HINDSIGHT_API_METRICS_BACKLOG_ENABLED=true
HINDSIGHT_API_METRICS_INCLUDE_BANK_ID=false
HINDSIGHT_API_ENABLE_OBSERVATION_HISTORY=true
HINDSIGHT_API_OBSERVATION_HISTORY_MAX_ENTRIES=50
HINDSIGHT_API_CONSOLIDATION_RECONCILE_INTERVAL_SECONDS=300
```

LLM 与 embedding API key 由 Hindsight Secret 提供。`4321` 只允许 Hindsight Pod 通过
NetworkPolicy 访问，不配置 `HINDSIGHT_API_OTEL_EXPORTER_OTLP_HEADERS`。

## Owner erase

owner erase 是个人记忆账户级删除，不是单次会话回滚。流程必须保持 `erasing`，直到：

1. generation fence 阻止旧 generation 新调用并等待旧 lease 排空；
2. Hindsight 旧 generation bank 删除成功；
3. execution-control 使用 command 冻结的产品 `UserID` 与 `source_updated_at` 上界，精确查询和
   删除同一 Langfuse project 中本次 erase 覆盖的 Agent/runtime trace；
4. 使用同一派生 bank 标识精确查询同一 project 的 `userId`，清空已退役
   generation bank 的全部 trace；
5. 两类查询均以 100 条为一页收集 trace ID，并按 100 条批量删除，`404` 视为幂等成功；
6. 旧 lease 排空且 bank 删除成功后等待 10 分钟，使 Collector 的 5 分钟最大重试窗口结束；
7. purge 并查询两类 trace，合计非零时每分钟重试，最多五轮；
8. 查询确认 Agent/runtime trace 在冻结上界内为零，且 Hindsight 已退役 bank 全部为零后，
   完成 command receipt、app-api callback 和产品 `erased` 投影；五轮未收敛则明确失败。上界之后的新 runtime trace
   不属于本次 erase，不得被删除或计入 remaining count。

Langfuse trace 删除是异步的，没有 completion webhook，因此不能以 DELETE HTTP 成功或本地
计数代替复查。maintenance client 使用 Basic auth；runtime 查询固定为精确 `userId` 加
`toTimestamp=command.source_updated_at`，Hindsight 查询固定为已退役 bank 的精确 `userId`。
HTTP timeout 为 15 秒、response 上限为 1 MiB，最多读取 1000 页并按有界批次删除；错误只能
暴露固定错误码，不记录 URL、credential、userId 或响应正文。

`LANGFUSE_MAINTENANCE_BASE_URL`、`LANGFUSE_MAINTENANCE_PUBLIC_KEY` 与
`LANGFUSE_MAINTENANCE_SECRET_KEY` 由 execution-control core worker 消费。部署环境缺少任何
一项时 core worker 启动失败；owner erase 也必须失败关闭，不能提前投影 `erased`。

## 来源删除

conversation prune/delete 在删除产品行前捕获 user message ID，并以最多 50 条为一批派生与 retain
完全相同的 `conversation:<conversation_hash>:message:<message_hash>` document ID。Hindsight
同步删除不存在的 document 视为幂等成功。

删除后必须等待 consolidation 生效，并确认已删除来源不再通过 recall 返回。不得通过删除
产品 message、隐藏 UI 或新建 bank 伪造来源删除成功。

## 监控

监控 Hindsight worker backlog、provider failure、consolidation、campus bounded
recall/append/command、`memory.call` 和 Langfuse maintenance。label 不得包含 user、tenant、
conversation、bank、document、message、operation 或 trace ID。

告警覆盖持续 provider error、worker backlog、consolidation failure、command outbox age、receipt
lease churn、Langfuse purge/verification failure 和长时间 `erasing`。事故排查使用 Hindsight 与
Langfuse 原生诊断，不建立产品 operation dashboard。

## 发布验证

使用 temporary owner/bank 和 synthetic data：

1. 创建并读取 bank policy，确认 observation/consolidation/Memory Defense 配置。
2. 从两个 conversation 同步 retain 两个 user-message document。
3. 验证 observation-preferred recall 返回预期有界事实。
4. 检查 `traceparent`/`baggage` 关联、`memory.call` 安全字段和 Langfuse service/tag 分类。
5. 删除一个 source document，并验证 consolidation 后不再召回。
6. 执行 owner erase，确认等待窗口内产品保持 `erasing`，随后 Hindsight bank not found、
   Agent/runtime trace 在 command 上界内为零且已退役 bank 对应的 Hindsight trace 为零。
7. 在 command 上界后生成一条新的 runtime trace，确认它不被删除，且收敛后产品进入 `erased`。
8. 在隔离 namespace 验证 PostgreSQL restore。

release evidence 不保存 synthetic source text、bank/user ID、credential 或 provider raw payload。

## 参考

- Hindsight retain：<https://hindsight.vectorize.io/developer/api/retain>
- Hindsight documents：<https://hindsight.vectorize.io/developer/api/documents>
- Hindsight Memory Defense：<https://hindsight.vectorize.io/developer/memory-defense>
- Langfuse 删除：<https://langfuse.com/docs/data-deletion>
- Temporal Go Activities：<https://docs.temporal.io/develop/go/activities>
