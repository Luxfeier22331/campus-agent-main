---
doc_type: runbook
owner_boundary: runtime-observability
status: active
---

# OpenTelemetry Collector

## 范围

本文说明如何校验和排查仓库拥有的 Collector 配置。事件、指标和字段合同见
`../reference/telemetry.md`；具体环境启用的 exporter 和 secret 由环境仓管理。

这里的 Collector 仅指 `infra/otel/` 下的 OpenTelemetry Collector，不是
`apps/source-collector`。

## 配置

- `infra/otel/collector-local-debug.yaml`：接收 trace、log 和 metric，执行字段过滤后写入
  debug exporter；
- `infra/otel/collector-local-prodlike.yaml`：本地验证 Langfuse 和可选 Axiom fan-out；
- `infra/otel/collector-staging-template.yaml`：部署模板，可将 trace 发往 Sentry、Axiom、
  Langfuse，将 log 和 metric 发往 Axiom；
- `infra/otel/collector.env.example`：变量名称和非敏感协议常量，不保存真实值。

业务 runtime 只发送 OTLP，不直接集成外部观测平台。Collector 在 exporter 前统一完成字段
删除、采样、批处理和重试。

## 结构校验

配置使用 contrib processor，必须用 `otelcol-contrib`：

```bash
APP_API_OTEL_INGEST_SHARED_SECRET=local-otel-proof-token \
  otelcol-contrib validate --config=infra/otel/collector-local-debug.yaml
APP_API_OTEL_INGEST_SHARED_SECRET=local-otel-proof-token \
  otelcol-contrib validate --config=infra/otel/collector-local-prodlike.yaml
APP_API_OTEL_INGEST_SHARED_SECRET=local-otel-proof-token \
  otelcol-contrib validate --config=infra/otel/collector-staging-template.yaml
```

仓库级结构检查：

```bash
pnpm contracts:check
pnpm ci:eval
```

`contracts:check` 校验延迟预算、观测告警配置及其可生成性；它不证明 Collector 或外部平台
正在运行。

## 本地调试

启动只写 debug exporter 的 Collector：

```bash
APP_API_OTEL_INGEST_SHARED_SECRET=local-otel-proof-token \
  otelcol-contrib --config=infra/otel/collector-local-debug.yaml
```

需要验证 execution-control 时，在运行时配置中启用 OTel，并将 trace/metric endpoint 指向
`127.0.0.1:4318` 对应路径。需要验证 app-api 时，同时配置受保护 HTTP receiver 的共享
secret。

通过标准：

- Collector health endpoint 正常；
- app-api 事件名称属于 `../reference/telemetry.md` 登记集合；
- execution-control 可以查询到 `execution_control.temporal.step_observation`；
- stage timing 产生 `campus.app_api.stage_duration_ms`；
- metric label 不包含请求、用户、会话、run、trace 或文档 ID；
- trace/log 中不存在 prompt、回答、检索正文、Cookie、Authorization、JWT 或 secret。

## 外部转发

只有明确验证外部平台时才启用 prodlike/staging 配置。真实 endpoint、header、dataset 和 key
必须来自 secret manager；不得写回仓库或本地可追踪文件。

关键约束：

- Sentry 使用其 OTLP endpoint 和 `x-sentry-auth`；
- Axiom exporter endpoint 使用 base domain，不手工追加 `/v1/traces`、
  `/v1/logs` 或 `/v1/metrics`；
- Langfuse endpoint 为 `<base-url>/api/public/otel`，认证值从项目 public/secret key 派生；
- Worker 发送到受保护的 Collector 入口，不直连 vendor；
- 实际启用的 sink 以环境仓中的 Collector 配置为准。

验证 Langfuse exporter 配置：

```bash
OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT=https://langfuse.example/api/public/otel \
OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER="Basic <base64-public-secret-pair>" \
OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION=4 \
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts check-collector-config --json
```

该命令只校验配置形态，不证明 trace 已经到达。

## 真实信号验证

先发起一条不包含敏感正文的真实请求，记录 `request_id`、`run_id` 和 `trace_id`，然后：

1. 在 Collector 日志和内部指标中确认 receiver 与 exporter 没有持续失败；
2. 在启用的 trace sink 按 `trace_id` 查询；
3. 在 log/metric sink 查询对应低基数事件和指标；
4. 检查跨 app-api、execution-control、Temporal/agent runtime 的关联标识；
5. 检查禁止字段没有进入任何下游。

需要核对 Langfuse trace 时使用：

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts verify-trace \
  --product-trace-id <product-trace-id> \
  --request-id <request-id> \
  --run-id <run-id> \
  --workflow-id <workflow-id> \
  --session-id <conversation-id> \
  --user-id <stable-user-id> \
  --release <runtime-release> \
  --json
```

运行结果属于本次发布或故障记录，不提交到仓库。

## 故障排查

Collector 收到信号但下游没有记录时，依次检查：

1. Collector 导出队列、重试和认证错误；
2. 过滤器是否因 `telemetry.drop=true` 主动丢弃；
3. trace 与日志采样比例；
4. 环境仓是否实际启用了目标导出器；
5. Sentry 请求头、Axiom 基础地址与数据集、Langfuse 地址、认证和版本；
6. Worker 是否错误地直连外部平台，或缺少 Collector bearer 认证；
7. 生产者字段是否被白名单或 Collector 处理器删除。

本地配置未启用某个 sink 时，缺少该 sink 的记录是预期行为。是否将遥测发送失败升级为产品
请求失败，由各 producer 的当前代码合同决定，本文不统一推断。
