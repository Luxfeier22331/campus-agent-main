# OTel Collector 配置

本目录保存本地 OpenTelemetry Collector 配置和跨环境字段策略。staging 的 Gateway 与 Agent
配置由环境仓 Helm values 唯一拥有；源码仓不维护第二份环境模板。

## 文件

- `collector-local-debug.yaml`：本地最小调试配置；
- `collector-local-prodlike.yaml`：本地生产近似链路；
- `collector.env.example`：配置所需的非敏感变量示例。

源码仓负责生产者字段合同、本地配置和信号清理策略测试。环境仓负责实际 receiver、pipeline、
endpoint、dataset、Secret、节点准备、部署版本和启用状态。应用与浏览器直接使用 Sentry SDK 的
链路不由这些 Collector 配置转发。

Gateway 的 `4318`、`4319`、`4320`、`4321` receiver 分别服务通用信号、execution-control 编排、
Agent 受信任 trace 和 Hindsight 受信任 trace。入口由 NetworkPolicy 隔离，不使用 bearer token。
Axiom log、trace 和 metric 共用 `OTEL_COLLECTOR_AXIOM_INGEST_TOKEN`，按 dataset 分流；Langfuse
OTLP 与 `activity-core` maintenance 凭据属于同一环境 project。exporter 只使用内存发送队列和
有界重试，不依赖持久存储。

## 验证

```bash
pnpm ci:otel
```

该命令运行信号策略测试，并使用固定 digest 的 Collector 镜像验证两份本地配置。staging Helm
values 的 render 与策略检查由环境仓负责。该检查不证明目标环境已部署，也不证明外部平台已经
收到信号。调试和故障排查见
`../../docs/runbooks/otel.md`。
