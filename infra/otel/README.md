# OTel Collector 配置

本目录保存仓库拥有的 OpenTelemetry Collector Gateway、Agent 和本地调试配置。配置文件是
receiver、processor、exporter 和 pipeline 连接关系的可执行来源；本文不复制端口、变量、字段
白名单或下游路由。

## 文件

- `collector-local-debug.yaml`：本地最小调试配置；
- `collector-local-prodlike.yaml`：本地生产近似链路；
- `collector-staging-template.yaml`：Gateway 环境模板；
- `collector-agent-staging-template.yaml`：节点 Agent 环境模板；
- `collector.env.example`：配置所需的非敏感变量示例。

源码仓负责配置结构、信号清理和静态校验。环境仓负责实际 endpoint、dataset、Secret、节点准备、
部署版本和启用状态。应用与浏览器直接使用 Sentry SDK 的链路不由这些 Collector 配置转发。

Gateway 的 `4318`、`4319`、`4320`、`4321` receiver 分别服务通用信号、execution-control 编排、
Agent 受信任 trace 和 Hindsight 受信任 trace。入口由 NetworkPolicy 隔离，不使用 bearer token。
Axiom log、trace 和 metric 共用 `OTEL_COLLECTOR_AXIOM_INGEST_TOKEN`，按 dataset 分流；Langfuse
OTLP 与 `activity-core` maintenance 凭据属于同一环境 project。exporter 只使用内存发送队列和
有界重试，不依赖持久存储。

## 验证

```bash
pnpm ci:otel
```

该命令使用仓库固定的 Collector 版本校验所有配置。它不证明目标环境已部署，也不证明外部平台
已经收到信号。调试和故障排查见 `../../docs/runbooks/otel.md`。
