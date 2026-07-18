# OTel Collector 配置

本目录保存仓库拥有的 OpenTelemetry Collector Gateway 与 Agent 配置。实际 endpoint、Secret、
dataset、保留期和部署版本由环境仓管理。

## 文件

- `collector-local-debug.yaml`：本地 OTLP/HTTP 输入，清理后只写 `debug` exporter。
- `collector-local-prodlike.yaml`：本地 execution-control 编排 trace 发送到 Langfuse environment
  project，并保留 `debug` 输出。
- `collector-staging-template.yaml`：staging/production Gateway 模板，包含四个 receiver、Axiom
  三类信号、一个 Langfuse environment project、平台指标抓取和内存发送队列。
- `collector-agent-staging-template.yaml`：DaemonSet Agent 模板，采集第一方容器日志与 kubelet
  指标并转发 Gateway。
- `collector.env.example`：变量名与非敏感协议常量；真实值由 Secret manager 提供。

## 信号路由

| 端口 | 生产者 | 下游 |
| ---: | --- | --- |
| `4318` | Collector Agent 和通用脱敏运行信号 | Axiom log、trace、metric |
| `4319` | execution-control 编排信号 | Axiom、Langfuse 编排与 Hindsight `memory.call` |
| `4320` | Agent runtime 受信任 trace | Langfuse environment project |
| `4321` | Hindsight 受信任 trace | Langfuse environment project |

四个 OTLP/HTTP receiver 通过固定端口与精确 NetworkPolicy 隔离生产者，不增加集群内 bearer
token，也不开放 OTLP/gRPC 兼容端口。

Gateway 在 Axiom exporter 前归一化 log body 与 span name，删除正文和未准入属性，清空 span
event/link，并只保留明确字段白名单。Axiom log、trace 和 metric 使用同一 ingest token 与不同 dataset；
metric exporter 使用 `x-axiom-metrics-dataset`，其他两个使用 `x-axiom-dataset`。

Langfuse 使用环境 project 的单一 endpoint 与 Basic auth，并按 receiver、service/tag 区分
runtime 与 Hindsight trace。受信任 Agent/Hindsight trace 不进入 Axiom，通用信号不进入
Langfuse。Collector 不向 Sentry 导出；Sentry 由应用和浏览器 SDK 消费。

Collector Agent 排除 Collector 与 Hindsight stdout，避免递归和记忆正文进入通用日志；
kubeletstats 使用挂载的 ServiceAccount CA 验证 kubelet。Agent 与 Gateway 使用内存队列，失败
最多重试 300 秒，不要求 node-local 存储或节点准备流程。Gateway 直接抓取 Hindsight `/metrics`
和 Collector 自身指标。

Cloudflare Worker 的 OpenTelemetry log destination 只把 producer 清理后的 application console
logs 直接写入 Axiom，不经过本目录的 Gateway 白名单，因此必须独立执行 query、header、正文、
用户标识和 credential 哨兵检查。Worker invocation logs 与 native traces 保持关闭；后端请求
trace 通过 W3C context 进入 execution-control，再由本目录 Gateway 写入 Axiom/Langfuse。

## 环境变量

Axiom 消费一个 `OTEL_COLLECTOR_AXIOM_INGEST_TOKEN` 与三个对应 dataset。
`OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT` 必须是 base domain；`otlphttp` exporter 自动追加
`/v1/traces`、`/v1/logs` 或 `/v1/metrics`。

Langfuse exporter 消费 `OTEL_COLLECTOR_LANGFUSE_{OTLP_ENDPOINT,AUTH_HEADER}`。ingestion
version 固定为已验证的 `4`，不是运行时可变的 Secret。

`LANGFUSE_MAINTENANCE_BASE_URL`、`LANGFUSE_MAINTENANCE_PUBLIC_KEY` 与
`LANGFUSE_MAINTENANCE_SECRET_KEY` 由 execution-control core worker 消费，用于 owner erase。
Collector 与 maintenance 使用环境唯一 project 的同一组 key。

## 验证

配置依赖 contrib 组件，必须使用与部署镜像一致的 `otelcol-contrib`。本地配置示例：

```bash
otelcol-contrib validate --config=infra/otel/collector-local-debug.yaml

OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT=http://127.0.0.1:3000/api/public/otel \
OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER='Basic <redacted>' \
  otelcol-contrib validate --config=infra/otel/collector-local-prodlike.yaml
```

staging Gateway 模板需要 `collector.env.example` 中全部 Gateway 变量。Agent 模板校验必须把
可读 CA 文件挂载到 `/var/run/secrets/kubernetes.io/serviceaccount/ca.crt`，否则 kubeletstats
会按预期拒绝配置。

仓库合同检查：

```bash
pnpm ci:eval
pnpm contracts:check
pnpm repo:static
```

配置校验只证明组件名和参数可加载。真实验收还必须验证 NetworkPolicy 端口隔离、内存队列
有界失败、Axiom 字段白名单、Langfuse service/tag 分类、Hindsight trace 关联和 Cloudflare application
log 旁路哨兵零匹配。具体步骤见 `../../docs/runbooks/otel.md`。
