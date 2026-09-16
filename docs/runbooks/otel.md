---
doc_type: runbook
owner_boundary: runtime-observability
status: active
---

# OpenTelemetry Collector

## 范围

本文说明如何校验本地单进程 Collector 和 Agent Runtime trace 出口。当前本地 receiver、端口和
pipeline 见 [OTel Collector 配置](../../infra/otel/README.md)；生产者字段见 [运行时遥测](../reference/telemetry.md)。环境 endpoint、
dataset、Secret、部署版本、保留期和启用状态由环境仓管理，源码检查不能证明远端状态。

这里的 Collector 指 OpenTelemetry Collector，与 `jobs/internal-portal-collection` 无关。Worker 的
Worker 的平台运行日志和 source map 不经过本 Collector，按 Worker 发布链路验证。

## 配置校验

运行仓库检查：

```bash
scripts/otel/validate-config.sh
```

该命令使用固定 digest 的 `otelcol-contrib` 镜像校验本地 debug 和 prodlike 配置。环境仓负责其
实际部署清单与远端状态；源码检查不证明目标环境已部署或外部平台已收到数据。

手工校验必须使用 contrib distribution，不能使用缺少处理器和 exporter 的 core distribution。
真实 endpoint、dataset 和凭据只能来自本地未跟踪环境或 Secret manager，不得写回仓库。

## 本地调试

启动 debug Collector：

```bash
otelcol-contrib --config=infra/otel/collector-local-debug.yaml
```

将 Agent Runtime 的 `OTEL_EXPORTER_OTLP_ENDPOINT` 指向 `http://127.0.0.1:4318`，然后运行 debug
Collector。它只输出 Agent trace。要验证 Langfuse 转发，使用
`docker-compose.execution-runtime.langfuse.yml` overlay，并在未跟踪环境中提供 Langfuse endpoint
和 key；不要把这些值写入仓库。

本地检查至少确认：

- Agent Runtime 在 endpoint 配置存在时只产生合同允许的 Agent/OpenInference span；
- trace producer 的 allowlist 在发送前删除合同禁止的属性和正文；
- debug 配置只输出到 debug exporter，prodlike 配置只发送到 Langfuse exporter；
- execution-control 的产品投影、Temporal history、Hindsight 业务请求和 W3C context propagation
  不依赖 Collector 成功。

## 真实信号验证

发起不包含真实认证材料的受控请求，记录产品 `requestId`：

1. 在 Agent Runtime 日志或本地 exporter 确认 trace 被生产；未配置 endpoint 时没有 trace 是预期
   行为。
2. 在 Langfuse project 查询 Agent trace，核对唯一产品 metadata `request_id`、environment、release
   和有限的模型/用量字段。Langfuse 原生 trace ID 只用于本次平台查询。
3. 使用合成哨兵覆盖 query、header、正文、用户标识和 credential 位置，确认 Langfuse trace 中
   不出现模型输入输出、对话、memory/retrieval 正文、工具原始载荷、Cookie、token、数据库地址
   或其他认证内容。
4. 若环境因 Langfuse 配额或成本策略停止 trace ingestion，不应把“没有新 trace”当作在线业务故障；
   改用 PostgreSQL 产品投影与所属运行时日志验证业务状态。

合成哨兵只验证代表性路径，不构成内容级 DLP 承诺；producer 的
`traceIncludeSensitiveData=false` 和字段白名单才是主要边界。正文规则以
[Langfuse 运行合同](../contracts/langfuse-runtime.md) 为准。

需要核对 runtime Langfuse trace 时使用：

```bash
pnpm --dir packages/eval-langfuse exec tsx ./src/cli.ts verify-trace \
  --trace-id <langfuse-trace-id> \
  --request-id <request-id> \
  --json
```

运行结果属于本次发布或故障记录，不提交到仓库。

## 故障排查

Agent trace 到达 Langfuse 但查询不到时，依次检查：

1. Agent Runtime 是否设置了 OTLP endpoint，以及进程是否实际产生受控 span；
2. 本地 Collector 配置是否通过 `scripts/otel/validate-config.sh`，endpoint、Basic auth 和压缩是否正确；
3. producer allowlist 是否在源头丢弃了该 span；
4. 环境仓是否选择了预期不可变版本和启用状态；
5. Langfuse 是否处于配额暂停、异步延迟或保留期边界。

Worker 平台诊断不能从 Collector 推断。任何观测输出失败都不得改写 PostgreSQL 产品状态。

## 参考

- OpenTelemetry Collector 配置：<https://opentelemetry.io/docs/collector/configuration/>
- Langfuse OpenTelemetry：<https://langfuse.com/integrations/native/opentelemetry>
