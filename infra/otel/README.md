# OTel Collector 配置

本目录保存本地单进程 OpenTelemetry Collector 配置和跨环境字段策略。staging 使用 Agent
DaemonSet 与 Gateway Deployment 两层拓扑，其配置由环境仓 Helm values 唯一拥有；源码仓不维护
第二份环境模板。

## 文件

- `collector-local-debug.yaml`：本地最小调试配置；
- `collector-local-prodlike.yaml`：本地生产近似链路；
- `collector.env.example`：本地 prodlike 配置所需的变量示例。

源码仓负责生产者字段合同、本地配置和信号清理策略测试。环境仓负责实际 receiver、pipeline、
endpoint、dataset、Secret、节点准备、部署版本和启用状态。应用与浏览器直接使用 Sentry SDK 的
链路不由这些 Collector 配置转发。

两份本地配置都只在 `4318` 提供一个 OTLP/HTTP receiver。debug 配置把 log、trace 和 metric 写到
debug exporter；prodlike 配置额外把受控编排 trace 写入 Langfuse，其余本地信号仍只写 debug
exporter。本地配置不模拟 staging 的 Axiom exporter、节点采集或网络隔离。

staging 由 Agent 采集第一方容器日志和 kubelet metrics，再发往提供 `4318`、`4319`、`4320`、
`4321` 四个 receiver 和下游 exporter 的 Gateway。入口由 NetworkPolicy 隔离，不使用 bearer
token。Gateway 以 `OTEL_COLLECTOR_AXIOM_INGEST_TOKEN` 消费环境共享的 Axiom runtime token，并按
dataset 分流 log、trace 和 metric；Langfuse OTLP 与 `activity-core` maintenance 凭据属于同一
project。exporter 只使用内存发送队列和有界重试，不依赖持久存储。

## 验证

```bash
pnpm ci:otel
```

该命令运行信号策略测试，并使用固定 digest 的 Collector 镜像验证两份本地配置。staging Helm
values 的 render 与策略检查由环境仓负责。该检查不证明目标环境已部署，也不证明外部平台已经
收到信号。调试和故障排查见
`../../docs/runbooks/otel.md`。
