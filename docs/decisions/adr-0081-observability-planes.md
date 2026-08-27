---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0081
status: accepted
supersedes:
  - ADR-0067
partially_superseded_by: ADR-0092
---

# ADR-0081：可观测数据边界

本 ADR 关于 Axiom application logs、Cloudflare log destination 和 Ops Web 固定日志查询的决定已由
[ADR-0092](./adr-0092-retire-axiom.md) 取代；其余 PostgreSQL、Temporal、Sentry、Langfuse、数据最小化
和无消费者信号删除原则继续有效。

## 背景

产品状态、Temporal history、应用错误、application logs 和 Agent/LLM trace 具有不同消费者与生命
周期。此前把节点日志、kubelet metrics、execution-control 编排、Hindsight trace 和 Collector
内部指标一起发送到供应商，产生了高基数和高频采集，却没有对应查询、告警或产品消费者。Ops Web
又复制这些信号成为服务探针、task queue 和 coverage 面，增加成本并把“无观测数据”误写成运行状态。

小团队当前需要的是能回答实际运维问题的最小信号面，不是持续维护一套通用 telemetry 平台。

## 决策

### 平台分工

- PostgreSQL 保存产品状态和有界运行投影；
- Temporal 保存 workflow history、task routing、retry、timeout 和 cancellation；
- Sentry 通过官方 SDK 保存浏览器和边缘错误、release、source map，以及生产 browser 的采样性能 trace；
- Langfuse 保存可选 Agent/LLM trace，并接收调用方按需发布的 score；仓库不把平台数据作为评测输入
  控制面；
- Ops Web 读取 PostgreSQL，并按需查询固定 Sentry Issues；
- 任何观测平台都不能改写产品状态、workflow 状态或个人记忆状态。

`requestId` 是产品 API、跨服务诊断、Sentry tag 和 Langfuse metadata 的唯一 durable business key。
W3C、Sentry 和 Langfuse 原生 trace ID 只属于各自技术系统，不进入产品 API 或持久业务投影。

### 保留的信号路径

Cloudflare native invocation logs 和 native traces 保持关闭，不能作为 Sentry 或持久产品状态的替代。
App API 不生产供应商专用请求生命周期日志；该决定由 ADR-0092 维护。

Agent Runtime 是唯一可选 OTel trace producer。它使用 SDK/OpenInference instrumentation、
producer-side allowlist 和 OTLP/HTTP exporter 发送到环境选择的 Langfuse 路径。execution-control
只传播 W3C context，不发送编排 span 或 runtime metric；Hindsight 不发送新 trace。

源码本地 Collector 只保留单 receiver Agent trace pipeline。debug 输出到本地 exporter，prodlike
输出到 Langfuse。环境仓可以选择等价出口，但源码仓不再规定节点 Agent/Gateway 双层拓扑。

### 删除的观测面

下列信号没有当前消费者，因此完整删除而不保留 fallback：

- kubelet receiver、节点 metrics 和 Collector detailed internal metrics；
- execution-control OTel exporter、Temporal OTel plugin、自研 metrics/emitter/sampler；
- Hindsight scrape、Hindsight OTel trace 和周期 backlog 工作；
- Axiom traces/metrics dataset 的应用消费者；
- Ops Web service probes、Temporal task queue、Collector uptime 和 telemetry coverage；
- app-api 与 campus-web 边缘端性能事务、staging/local 浏览器性能事务；
- 浏览器自定义 TTFT metric、周期 dispatcher 成功日志和 credential-check 成功事件。

普通进程错误与生命周期日志可以继续供 `kubectl logs` 或本地诊断使用，但它们不构成新的供应商
事件 taxonomy。

### 数据最小化

Agent trace 只允许 user/session 关联、model/provider、Agent/tool 名称、usage、阶段结果以及唯一产品
metadata `request_id`。prompt、模型输入输出、对话、工具原始载荷、
memory/retrieval 正文、provider 原始响应和认证材料不得进入运行 trace。

评测输入由调用方显式提供，不能从生产 trace 正文自动生成。运行 trace 已在 producer 侧排除对话、
个人记忆正文和工具载荷；个人记忆清除不依赖 Langfuse，也不把外部观测数据删除建模为产品终态。

### 凭据

观测平台凭据由各自的环境交付链路维护，源码仓只拥有稳定的消费合同。没有新的信任边界时，不按
数据集、消费者、运行时或 API 操作继续拆分 provider 身份。不同 Secret 名称只表示交付位置，是否
映射到同一上游身份由环境仓决定。

Agent Runtime 的 Langfuse trace 凭据只由 trace producer 消费；Sentry 和其他平台凭据不进入
产品数据库、观测事件正文或 `packages/contracts`。

## 后果

- Langfuse 配额停收只降低 Agent trace 可见性，不影响在线业务、readiness 或产品终态；
- Ops Web 概览只回答产品请求状态，不把外部信号缺失推断成系统故障；
- Source 只维护 Agent trace producer 合同和本地 Collector，环境是否启用由环境仓决定；
- 删除最后一个消费者时，配置、schema、文档、测试、环境变量和网络权限必须一起删除。

## 未采用方案

- **保留无消费者 metrics/traces 以备未来使用**：持续产生供应商成本和错误告警语义。
- **让 Ops Web 成为通用日志、trace 或 Temporal 代理**：扩大高权限查询面并复制成熟平台。
- **从 trace ID 派生产品关联标识**：把可选、供应商所有的技术标识错误提升为业务主键。
- **为每个数据集或消费者新建 token**：没有新的信任边界，只增加交付和轮换故障面。
- **用第二套存储作为观测故障回退**：重新引入重复数据路径和不一致状态。

## 相关文档

- `../reference/telemetry.md`
- `../contracts/langfuse-runtime.md`
- `../runbooks/otel.md`
- `../runbooks/worker-otel.md`
- `adr-0072-self-hosted-ops-web.md`
- `adr-0076-langfuse-trace-data.md`
