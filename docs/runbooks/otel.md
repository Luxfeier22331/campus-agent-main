---
doc_type: runbook
owner_boundary: runtime-observability
status: active
---

# OpenTelemetry Collector

## 范围

本文说明如何校验和排查仓库拥有的 Collector Gateway 与 Agent 配置。事件、指标和字段合同见
`../reference/telemetry.md`；环境 endpoint、dataset、Secret、保留期和启用状态由环境仓管理。

这里的 Collector Agent 是 OpenTelemetry Collector DaemonSet，不是 `apps/source-collector`。
Cloudflare Worker application-log destination 不经过本 Collector，必须按本文单独验证。

## 配置文件

- `infra/otel/collector-local-debug.yaml`：本地受认证 OTLP/HTTP 输入，清理后只写 `debug`。
- `infra/otel/collector-local-prodlike.yaml`：本地 execution-control 编排 trace 进入 Langfuse runtime
  project，并保留 `debug` 输出。
- `infra/otel/collector-staging-template.yaml`：Gateway 模板，包含四个入口、Axiom 三类输出、两个
  Langfuse project、平台 metrics scrape 和持久发送队列。
- `infra/otel/collector-agent-staging-template.yaml`：DaemonSet Agent 模板，采集第一方容器日志和
  kubelet 指标并转发 Gateway。
- `infra/otel/collector.env.example`：变量名称与非敏感协议常量；真实 token 和 endpoint 由 Secret
  manager 提供。

## Gateway 入口

| 端口 | receiver | 生产者 | 输出 |
| ---: | --- | --- | --- |
| `4318` | `otlp/agent` | Collector Agent、通用脱敏信号 | Axiom log、trace、metric |
| `4319` | `otlp/orchestration` | execution-control | Axiom trace/metric、Langfuse runtime、`memory.call` 到 Hindsight project |
| `4320` | `otlp/agent_trusted` | Agent runtime | Langfuse runtime project |
| `4321` | `otlp/hindsight_trusted` | Hindsight | Langfuse Hindsight project |

每个 receiver 只启用 OTLP/HTTP，使用独立 bearer token 与 NetworkPolicy。不得恢复共享 ingest
secret、开放 receiver 或 OTLP/gRPC 兼容入口。

Gateway 对 Axiom 信号执行明确白名单：归一化任意 log body 与 span name，清空 status message、
event 和 link，只保留受控资源与关联字段。通用入口不能写 Langfuse；受信任入口不能写 Axiom。
Collector 不向 Sentry 导出。

Agent 只读取第一方 namespace 的容器日志，排除 Collector 与 Hindsight stdout；kubeletstats 使用
ServiceAccount 并以挂载 CA 验证 kubelet。Agent 必须从 Pod label 补齐 `service.name`，解析单行
JSON 后只保留准入关联字段，并在导出前将正文替换为固定值。Gateway 直接抓取 Hindsight `/metrics` 和 Collector
自身指标，避免通过 stdout 建立递归采集。

Agent 的 filelog checkpoint 和发送队列必须使用 node-local `/var/lib/otelcol`。在每个可调度节点由
环境仓受 staging Environment 保护的 `prepare-observability-node` workflow 安装并校验
systemd-tmpfiles 合同，然后才允许 rollout；GitOps validation 会再次只读校验。Helm hostPath 使用
`Directory`，缺少前置目录时必须阻止调度，不得自动创建 root-owned 目录，也不得把 Agent 改为
root。rollout 后重启一个 Agent Pod，确认 checkpoint 延续、队列目录可写且没有重复回放或停机窗口
缺口。

## 结构校验

配置依赖 contrib 组件，必须使用与部署镜像一致的 `otelcol-contrib` 版本。校验前先确认命令或
容器实际版本；不要用 core distribution。

本地 debug：

```bash
OTEL_COLLECTOR_ORCHESTRATION_INGEST_TOKEN=local-otel-proof-token \
  otelcol-contrib validate --config=infra/otel/collector-local-debug.yaml
```

本地 prodlike 还必须提供 Langfuse runtime endpoint 和认证：

```bash
OTEL_COLLECTOR_ORCHESTRATION_INGEST_TOKEN=local-otel-proof-token \
OTEL_COLLECTOR_LANGFUSE_RUNTIME_OTLP_ENDPOINT=http://127.0.0.1:3000/api/public/otel \
OTEL_COLLECTOR_LANGFUSE_RUNTIME_AUTH_HEADER='Basic <redacted>' \
  otelcol-contrib validate --config=infra/otel/collector-local-prodlike.yaml
```

staging Gateway 模板必须在临时环境提供 `infra/otel/collector.env.example` 中全部 Gateway 变量后
校验；不得把真实值写回仓库。Agent 模板校验还必须把一个可读 CA 文件挂载到
`/var/run/secrets/kubernetes.io/serviceaccount/ca.crt`，因为 kubeletstats 配置会在校验阶段读取它。

仓库级合同检查：

```bash
pnpm contracts:check
pnpm ci:eval
```

这些命令只证明配置和合同形态，不证明 Collector、Axiom 或 Langfuse 正在运行。

## 本地调试

启动 debug Collector：

```bash
OTEL_COLLECTOR_ORCHESTRATION_INGEST_TOKEN=local-otel-proof-token \
  otelcol-contrib --config=infra/otel/collector-local-debug.yaml
```

execution-control 的 trace/metric endpoint 指向 `127.0.0.1:4318` 的相应 OTLP 路径，并通过
`EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_HEADERS` 发送同一 bearer token。app-api 不再使用手写
OTLP exporter；它写经过白名单的结构化 console lifecycle event，由 Cloudflare application-log
destination 消费。

通过标准：

- 未带 token 和使用其他入口 token 的请求均被拒绝；
- execution-control 可以观察到受控 `execution_control.*` span 和低基数 metric；
- `memory.call` 只含 provider 与 HTTP method，不含 URL、bank、document 或正文；
- metric label 不包含请求、用户、会话、run、trace、bank 或文档 ID；
- Axiom 路径中不存在 prompt、回答、检索正文、memory、Cookie、Authorization、JWT 或 secret。

## 外部转发

只有明确验证外部平台时才启用 prodlike/staging 配置。真实 endpoint、header、dataset 和 key
必须来自 Secret manager。

关键约束：

- Axiom log、trace、metric 使用不同 token 与 dataset；metric exporter 使用
  `x-axiom-metrics-dataset`，log/trace 使用 `x-axiom-dataset`。
- `OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT` 是 base domain，`otlphttp` exporter 自动追加 signal
  path。
- Langfuse endpoint 为 `<base-url>/api/public/otel`，runtime 与 Hindsight 使用不同项目和
  Basic auth。
- Agent runtime 与 Hindsight 的受信任 trace 不能进入 Axiom；通用信号不能进入 Langfuse。
- Sentry 由 browser/edge SDK 直接消费，不存在 Collector Sentry endpoint 或 credential。
- 实际启用的 exporter、dataset 和 retention 以环境仓 desired state 为准。

验证 Langfuse Collector 配置时，分别提供 runtime 与 Hindsight project 参数；已有 CLI 检查只
验证其支持的配置形态，不替代真实 trace 查询。

## 真实信号验证

先发起不包含真实敏感正文的受控请求，记录 `request_id`、`run_id` 和 `trace_id`，然后：

1. 在 Gateway 自身指标确认四个 receiver 的认证拒绝、接收量、持久队列和 exporter failure。
2. 在 Axiom 分别查询 Collector 写入的 log、trace 和 metric，确认字段只在白名单内；用
   `request_id`/`trace_id` 确认 execution-control runtime trace 是请求级调用链证据。
3. 在 Langfuse runtime project 查询 Agent 与 `execution_control.*` trace。
4. 执行一次 Hindsight retain/recall，在独立 Hindsight project 确认 `memory.call` 与下游 span
   关联，且没有出现在 runtime project。
5. 使用合成哨兵填入 query、header、正文、用户标识和 credential 位置；Collector 输出、Worker
   application logs 与 Sentry 必须为零匹配。
6. 验证 Hindsight trace 的 `langfuse.user.id` 等于 execution-control 派生的 bank 标识，Collector
   已删除原 `bank_id` 属性且未再次加盐。

需要核对 runtime Langfuse trace 时使用：

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

## Cloudflare application-log 旁路

app-api 与 campus-web 的源码 Wrangler 配置镜像 application-log-only 契约；实际 staging
observability 是环境 Terraform 拥有的非版本化设置，只把 producer 清理后的 application console
logs 发送到 Axiom log destination，并设置 `persist=false`。这条路径绕过 Gateway 的
`transform/axiom_safe`，因此必须单独检查实际 payload：

1. 确认 environment-specific log destination 名称生效，而不是只读取顶层配置。
2. 确认 `invocation_logs=false`、`observability.traces.enabled=false`，且没有 trace destination。
3. 发送包含 OAuth/reset query、测试 header、正文、用户 ID 和 credential 哨兵的受控请求，触发
   producer 已准入的 application log。
4. 在 Axiom log dataset 确认允许事件及其关联字段可查询，并搜索全部哨兵；不能用 invocation log
   或 native trace 的存在替代该证据。
5. 任一敏感值出现时，先关闭 log destination 或对应 producer 输出；出现 invocation log/native
   trace 时按配置漂移处理。

该检查未通过前不得执行 OpenObserve 资源删除。Collector 白名单不能作为 application-log 旁路
安全证明；请求级 trace 必须另行查询 execution-control 经 Collector 写入的 runtime trace。

## 故障排查

Collector 收到信号但下游没有记录时，依次检查：

1. producer 使用的端口、bearer token 与 NetworkPolicy 是否匹配；
2. receiver、file-backed queue、retry 与 exporter 的失败指标；
3. `telemetry.drop`、入口过滤器、字段 transform 和采样比例；
4. Axiom endpoint、三种 header/dataset/token，或 Langfuse project endpoint/Basic auth；
5. 受信任 trace 是否被错误发送到通用入口，或项目路由是否交叉；
6. Agent 是否因 kubelet CA/SAN 校验失败、`/var/lib/otelcol` 不可写，或 filelog
   include/exclude 路径不匹配；
7. 环境仓是否实际启用了目标 exporter 和正确不可变版本。

Cloudflare application-log destination 问题必须在 Cloudflare 与 Axiom 两侧排查，不能从 Gateway
指标推断。
任何观测输出失败都不得改写 PostgreSQL 产品状态。

## 参考

- OpenTelemetry Collector 配置：<https://opentelemetry.io/docs/collector/configuration/>
- Axiom OpenTelemetry ingest：<https://axiom.co/docs/send-data/opentelemetry>
- Langfuse OpenTelemetry：<https://langfuse.com/docs/integrations/native/opentelemetry>
- Cloudflare Workers OpenTelemetry：
  <https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/>
