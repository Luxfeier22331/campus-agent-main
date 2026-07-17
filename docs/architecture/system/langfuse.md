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

Langfuse 分成两个项目：

- runtime project 保存 Agent runtime、模型/工具调用和受控 execution-control 编排 trace；
- Hindsight project 保存 execution-control 的 `memory.call` 父 span 与 Hindsight 原生 trace。

两个项目使用不同 OTLP endpoint/credential 和维护权限，不得通过 tag 模拟项目隔离。

## Trace 链路

```text
app-api W3C context
-> execution-control Go OTel -> Collector :4319
-> agent-runtime OpenAI Agents SDK instrumentation -> Collector :4320
-> Langfuse runtime project

execution-control Activity context
-> memory.call + traceparent/baggage -> Collector :4319
-> Hindsight native OTel -> Collector :4321
-> Langfuse Hindsight project
```

execution-control 的 `4319` trace 分成三条受控 pipeline：脱敏副本进入 Axiom，名称匹配
`execution_control.*` 的受控属性进入 Langfuse runtime project，`memory.call` 进入 Langfuse
Hindsight project。Agent runtime `4320` 与 Hindsight `4321` 是受信任 trace 入口，不进入 Axiom。

每个入口使用独立 bearer token 与 NetworkPolicy。Collector 只路由到固定 project，并删除
credential 类属性。endpoint、header、service name 与 deployment environment 来自部署配置。

Hindsight HTTP client 为每次 provider 请求建立 `memory.call` client span，并传播当前 W3C
`traceparent` 与 `baggage`。该 span 只记录 provider 与 HTTP method，不记录 URL、bank、document
或正文。

Langfuse 不可用不得阻塞普通在线回答。Temporal 和 PostgreSQL 受控投影仍是执行生命周期与产品
诊断真相；owner erase 和隐私 retention 是例外，它们必须等待 Langfuse 删除合同完成。

## 身份与关联

runtime project 使用产品 `trace_id`、`request_id`、`run_id`、`workflow_id`、conversation/session
和产品 user identity 关联真实执行。owner erase 使用 command 冻结的 `UserID`，并以
`command.source_updated_at` 为上界，精确删除和复核该用户在命令时点前的 runtime trace；命令后
产生的新 trace 不属于本次删除。关联字段存在只说明 producer 设置了 identity，不证明 Langfuse
已接收。

Hindsight project 的 `langfuse.user.id` 必须等于 execution-control 已按 owner salt、tenant、user
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
   `command.source_updated_at` 作为 `toTimestamp`，查询 runtime project。
2. 以已退役 generation 的派生 bank 标识作为精确 `userId` 查询 Hindsight project；generation
   fence 已阻止该 bank 接收新调用，因此这里清空整个 bank，不加时间上界。
3. 两个项目都按有界分页和批量 DELETE 清理；`404` 视为幂等成功。
4. 等待 15 分钟，再次 purge 并查询两个项目的剩余数；合计非零时每分钟重试到零。
5. 第一检查点收敛后再等待 23 小时 45 分钟，再次 purge 并查询；因此第二检查点不会早于首次
   purge 后 24 小时，非零时继续每分钟重试。
6. 两个检查点都确认 runtime project 在冻结上界内为零，且 Hindsight 已退役 bank 全部为零后，
   才 finalize command receipt 与产品 `erased` 状态。

Langfuse 删除通常异步完成且没有完成回调，因此 DELETE 成功不是 erase 完成证明。maintenance
失败不能降级为 warning，也不能让产品提前离开 `erasing`。Temporal history 只保存 bounded count
和固定错误码作为 maintenance 结果；command 已冻结的产品 identity 仍按记忆生命周期合同进入
workflow input，但不得额外写入 endpoint、credential、派生 bank ID、trace ID 列表或响应正文。

runtime trace 可能在模型输入中包含 memory context，不能可靠地只按某个 memory tag 识别全部
派生副本。因此 owner erase 对 runtime project 采用“稳定 user identity + command 时间上界”的
user-wide 删除，而不是只删当前 conversation、request 或显式 memory span；时间上界避免误删
erase 请求之后的新 trace。这是账户级隐私删除边界，不是单次会话回滚。

## 七天保留

self-hosted Langfuse 默认不会为社区版本自动执行 project retention。仓库用 Temporal Schedule
`campus-agent.langfuse.trace-retention.daily.v1` 每天 UTC 03:00 启动
`LangfuseTraceRetentionWorkflow`，同时处理 runtime 与 Hindsight project 中早于 workflow 启动
时间减七天的 trace。

workflow 对两个 project 执行 purge，等待 15 分钟后按同一 cutoff 查询剩余数量；非零时再执行
purge/verify，最多三轮。三轮仍未收敛时以固定非重试错误结束，本次 Schedule 失败可见，但
Schedule 不自动暂停；下一次日常运行会继续处理。Schedule 使用 overlap `SKIP`、24 小时 catchup
window 和六小时 workflow run timeout，避免两个 retention run 同时删除。

七天是删除准入 cutoff，不是上游服务对精确删除时刻的承诺。只有两个 project 对该 cutoff 的
查询都为零，workflow 才成功。Purge/verify 使用 Temporal Activity heartbeat、有限重试和 bounded
pagination；Langfuse API、任一项目 credential 或查询不可用时失败关闭。

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
- owner erase/retention 的 maintenance 读取或删除失败必须由 Temporal 重试并保持未完成状态。
- project、credential、Collector pipeline 或 schedule 配置存在不证明 trace 已隔离或已删除；
  必须分别查询两个项目并验证错误项目零匹配。
- OpenObserve 不保存 Langfuse 副本，也不属于回滚路径。

## 相关文档

- `../../contracts/langfuse-runtime.md`
- `../../runbooks/hindsight.md`
- `../../runbooks/otel.md`
- `../../reference/eval.md`
- `../../decisions/adr-0059-langfuse.md`
- `../../decisions/adr-0076-langfuse-trace-data.md`
- `../../decisions/adr-0081-observability-planes.md`
