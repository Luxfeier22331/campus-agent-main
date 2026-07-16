# OTel Collector 配置

本目录包含仓库拥有的 OpenTelemetry Collector 配置。

## 文件

- `collector-local-debug.yaml`：接收本地 OTLP trace、metric 与 log，删除禁止字段后写入
  Collector `debug` exporter；
- `collector-local-prodlike.yaml`：可选的本地 fan-out 配置；应用相同字段删除策略，将 trace
  发往本地 Langfuse OTLP endpoint 与 `debug` exporter，并在配置 Axiom 环境变量后发送 metric；
- `collector-staging-template.yaml`：staging/production 模板；应用相同字段删除与采样策略，将
  trace 发往 Sentry、Axiom 与 Langfuse，将 log 和 metric 发往配置的 Axiom dataset；
- `collector.env.example`：所需环境变量与受保护 OTLP HTTP 输入示例。secret 值保持为空，由
  部署 secret manager 提供。

## 信号路由

- runtime app 将 OTLP 发给 Collector，不直连外部观测平台；
- Cloudflare Worker 通过受保护的 Collector OTLP HTTP receiver 发送信号；receiver 使用 bearer
  auth，并只接受 `/v1/traces`、`/v1/logs` 等有效 OTLP 路径；
- Collector 在任何 exporter 运行前删除仓库禁止字段；
- Sentry 与 Langfuse 只接收 trace；Axiom 接收 trace、log 与 metric。endpoint、auth header 与
  dataset 都由 Collector exporter 环境变量配置，Worker 不配置 Axiom REST ingest；
- `OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT` 必须是 base domain，不能包含 `/v1/traces`、
  `/v1/logs` 或 `/v1/metrics`，因为 `otlp_http` exporter 会追加 signal path；
- 默认本地 execution-control 使用 `collector-local-debug.yaml`，不需要外部平台 credential；
- 只有明确测试外部 fan-out 时才加入
  `infra/local/docker-compose.execution-runtime.fanout.yml`，需要本地 Langfuse 时再启动
  `infra/local/docker-compose.langfuse.yml`；
- Langfuse 使用 `/api/public/otel` endpoint；ingestion version 由
  `OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION` 配置；
- staging 默认使用 local-debug 配置。只有部署了外部平台 credential 时才切换到
  `collector-staging-template.yaml`；
- staging 的 Collector OTLP HTTP receiver 通过受保护 route 暴露，不直接暴露外部平台或绕过
  Collector pipeline。

## 验证

这些配置依赖部分最小 Collector distribution 不一定包含的 processor，因此使用
`otelcol-contrib` 校验：

```bash
APP_API_OTEL_INGEST_SHARED_SECRET=local-otel-proof-token \
  otelcol-contrib validate --config=infra/otel/collector-staging-template.yaml
APP_API_OTEL_INGEST_SHARED_SECRET=local-otel-proof-token \
  otelcol-contrib validate --config=infra/otel/collector-local-debug.yaml
APP_API_OTEL_INGEST_SHARED_SECRET=local-otel-proof-token \
  otelcol-contrib validate --config=infra/otel/collector-local-prodlike.yaml
```

缺少 `APP_API_OTEL_INGEST_SHARED_SECRET` 时 Collector receiver 失败关闭。staging template 还会
替换 exporter 环境变量；使用真实 Collector 校验 fan-out 前需填充 `collector.env.example`。

没有本地 Collector binary 时，执行仓库结构检查：

```bash
pnpm ci:eval
pnpm contracts:check
pnpm repo:static
```

启动 compose 前检查已填充的 staging shell：

```bash
pnpm --dir packages/eval-langfuse langfuse check-collector-config --json
```

`pnpm contracts:check` 还会将 `configs/runtime/observability-alerts.v1.json` 转换为 Axiom
monitor spec；启用的 alert rule 无法表示为单个 monitor 时检查失败。
