# OTel Collector 配置

本目录只保存本地单进程 OpenTelemetry Collector 配置。源码仓拥有 Agent Runtime 的 producer
字段边界和本地验证；环境仓拥有实际部署是否启用 Collector、endpoint、Secret、资源和保留策略。
源码仓不把本地配置或网络清单写成目标环境已部署事实。

## 文件

- `collector-local-debug.yaml`：本地最小调试配置；
- `collector-local-prodlike.yaml`：本地生产近似链路。

源码仓负责 Agent Runtime 生产者字段合同和本地配置。环境仓负责实际 receiver、pipeline、endpoint、
dataset、Secret、部署版本和启用状态。Cloudflare application logs、浏览器和边缘 Sentry 不经过这些
本地配置。

两份本地配置都只在 `4318` 提供一个 OTLP/HTTP receiver，并且只接收 Agent Runtime trace：

- `collector-local-debug.yaml`：`traces/agent -> debug`；
- `collector-local-prodlike.yaml`：`traces/agent -> Langfuse`。

这里没有日志、指标、kubelet、execution-control 或 Hindsight pipeline，也不模拟节点采集、集群
网络隔离或供应商告警。Langfuse overlay 只用于开发者明确验证 Agent trace，不能
作为线上配额或部署状态的证明。

## 验证

```bash
scripts/otel/validate-config.sh
```

该命令使用固定 digest 的 Collector 镜像和脚本内验证值校验两份本地配置。环境仓的 render、部署和远端状态由环境
仓负责；本检查不证明目标环境已经部署，也不证明外部平台已经收到信号。调试和故障排查见
`../../docs/runbooks/otel.md`。
