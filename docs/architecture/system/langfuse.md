---
doc_type: architecture
owner_boundary: runtime-observability
status: active
---

# Langfuse

## 边界

Langfuse 是受信任的 LLM 与记忆可观测和评测平台，保存 trace、dataset、experiment run、score
和 annotation 工作流。它不拥有在线执行、产品数据库、Temporal history、Hindsight bank、仓库
合同或发布决定。

每个环境使用一个固定 project；staging 名称为 `campus-agent-staging`。Agent runtime、受控
execution-control 编排 trace、`memory.call` 与 Hindsight 原生 trace 通过独立 receiver、
`service.name` 和固定 tag 区分，共用该 project 的 OTLP 与维护凭据。

## Trace 链路

```text
app-api W3C context
-> execution-control Go OTel -> Collector :4319
-> agent-runtime OpenAI Agents SDK instrumentation -> Collector :4320
-> Langfuse environment project

execution-control Activity context
-> memory.call + traceparent/baggage -> Collector :4319
-> Hindsight native OTel -> Collector :4321
-> Langfuse environment project
```

execution-control 的 `4319` trace 分成三条受控 pipeline：脱敏副本进入 Axiom，名称匹配
`execution_control.*` 的受控属性和 `memory.call` 进入同一 Langfuse project。Agent runtime
`4320` 与 Hindsight `4321` 是受信任 trace 入口，不进入 Axiom。

四个入口使用固定端口和精确 NetworkPolicy 隔离生产者，不在集群内重复增加 bearer token。
Collector 只路由到环境 project，并删除 credential 类属性。endpoint、project credential、
service name 与 deployment environment 来自部署配置。

Hindsight HTTP client 为每次 provider 请求建立 `memory.call` client span，并传播当前 W3C
`traceparent` 与 `baggage`。该 span 只记录 provider 与 HTTP method，不记录 URL、bank、document
或正文。

Langfuse 不可用不得阻塞普通在线回答。Temporal 和 PostgreSQL 受控投影仍是执行生命周期与产品
诊断真相；owner erase 是例外，必须等待 Langfuse 删除合同完成。

## 身份与关联

Agent/runtime trace 使用产品 `trace_id`、`request_id`、`run_id`、`workflow_id`、conversation/session
和产品 user identity 关联真实执行。owner erase 使用 command 冻结的 `UserID`，并以
`command.source_updated_at` 为上界，精确删除和复核该用户在命令时点前的 runtime trace；命令后
产生的新 trace 不属于本次删除。关联字段存在只说明 producer 设置了 identity，不证明 Langfuse
已接收。

Hindsight trace 的 `langfuse.user.id` 必须等于 execution-control 已按 owner salt、tenant、user
和 generation 派生的 bank 标识。Collector 映射后删除 `hindsight.bank_id`/`bank_id` 源属性，
不得再次哈希。这样 owner erase 能以同一 deterministic identity 精确删除旧 generation trace，
并验证已退役 bank 的 trace 全部清空，同时不向 Langfuse 暴露产品 user ID。

## 数据边界

self-hosted Langfuse 是受信任内部观测面。采样 trace 可以包含 user/session 关联、模型输入输出、
memory context、已授权 retrieval facts、tool observation 和 usage；Authorization、Cookie、API key、
密码、数据库凭据、对象存储 secret 与 provider credential 始终禁止。

app-api、Ops Web、Axiom 和 Sentry 只保存关联标识与有界摘要，不复制 Langfuse trace 正文。
score metadata 只允许标量白名单字段；答案和 context text 留在 trace、dataset 和 Ragas sample。

Hindsight stdout 不进入通用 filelog，Hindsight trace 不进入 Axiom。该隔离不能只依赖开发者不写
日志，必须由 Collector Agent exclude、receiver 路由和下游 canary 一起证明。

## Owner erase

Hindsight bank 删除成功后，Temporal `PersonalMemoryCommandWorkflow` 继续编排 Langfuse 删除：

1. 以 command 冻结的产品 `UserID` 作为精确 `userId`，同时以
   `command.source_updated_at` 作为 `toTimestamp`，查询环境 project。
2. 在同一 project 中以已退役 generation 的派生 bank 标识作为精确 `userId` 查询；generation
   fence 已阻止该 bank 接收新调用，因此这里清空整个 bank，不加时间上界。
3. 两类查询都按有界分页和批量 DELETE 清理；`404` 视为幂等成功。
4. generation fence 排空旧 lease 且 Hindsight 删除成功后等待 10 分钟；Collector exporter 的
   最大重试窗口为 5 分钟，因此不再有旧 generation trace 在等待结束后补写。
5. purge 后查询两类 trace 的剩余数；合计非零时每分钟重试，最多五轮。
6. 查询为零后 finalize command receipt 与产品 `erased` 状态；五轮仍未收敛则明确失败并保持
   未完成状态。

Langfuse 删除通常异步完成且没有完成回调，因此 DELETE 成功不是 erase 完成证明。maintenance
失败不能降级为 warning，也不能让产品提前离开 `erasing`。Temporal history 只保存 bounded count
和固定错误码作为 maintenance 结果；command 已冻结的产品 identity 仍按记忆生命周期合同进入
workflow input，但不得额外写入 endpoint、credential、派生 bank ID、trace ID 列表或响应正文。

runtime trace 可能在模型输入中包含 memory context，不能可靠地只按某个 memory tag 识别全部
派生副本。因此 owner erase 对 Agent/runtime trace 采用“稳定 user identity + command 时间上界”的
user-wide 删除，而不是只删当前 conversation、request 或显式 memory span；时间上界避免误删
erase 请求之后的新 trace。这是账户级隐私删除边界，不是单次会话回滚。

## 评测链路

```text
repo cases.v1.json
-> 真实 app-api / Temporal / Agent SDK 请求
-> eval projection + runtime product trace
-> Langfuse dataset-run-item 关联
-> eval-langfuse 安全适配
-> ragas-runner 官方指标
-> Langfuse registered scores
```

`packages/eval-langfuse` 负责平台 API、真实产品 dataset run、dataset/score config sync、安全
投影、trace 关联、score 发布和 trace 验证。`packages/ragas-runner` 只调用 Ragas 官方
`ascore()`，不拥有 dataset、编排或发布 gate。

每个 dataset item 通过官方 API 关联真实 product trace，不使用 `runExperiment` 创建第二条合成
执行 trace。模型成本由 Langfuse 根据 model identity 和 token usage 计算，运行投影不维护平行
成本估算。

## 可用性和验证

- trace export 失败只降低观测能力，不修改在线回答终态。
- eval 命令的 Langfuse 读取或写入失败必须使该离线命令失败。
- owner erase 的 maintenance 读取或删除失败必须由 Temporal 有界重试并保持未完成状态。
- project、credential 或 Collector pipeline 配置存在不证明 trace 已正确分类或删除；
  必须按 service/tag 和两类 erase identity 分别验证。
- OpenObserve 不保存 Langfuse 副本，也不属于回滚路径。

## 相关文档

- `../../contracts/langfuse-runtime.md`
- `../../runbooks/hindsight.md`
- `../../runbooks/otel.md`
- `../../reference/eval.md`
- `../../decisions/adr-0059-langfuse.md`
- `../../decisions/adr-0076-langfuse-trace-data.md`
- `../../decisions/adr-0081-observability-planes.md`
