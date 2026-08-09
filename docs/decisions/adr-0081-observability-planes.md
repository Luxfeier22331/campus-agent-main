---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0081
status: accepted
supersedes:
  - ADR-0067
---

# ADR-0081：可观测数据边界

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
- Axiom 只保存 producer 已清理的 Cloudflare Worker application logs；
- Sentry 通过官方 SDK 保存浏览器和边缘错误、release、source map，以及生产 browser 的采样性能 trace；
- Langfuse 保存可选 Agent/LLM trace，以及 dataset、score、experiment 和 annotation；
- Ops Web 读取 PostgreSQL，并按需查询固定 Axiom logs 与 Sentry Issues；它只生成 Temporal 和
  Langfuse 外部入口；
- 任何观测平台都不能改写产品状态、workflow 状态或个人记忆状态。

`requestId` 是 Axiom application-log 查询的 durable business key。`traceId` 保留为产品关联和
外部跳转标识，但不与 requestId 组成强制双条件查询。

### 保留的信号路径

app-api 只发出三个有消费者的结构化 application events：

- `request.accepted`；
- `request.finalized`；
- `request.transport_error`。

Cloudflare application-log destination 直接把这些事件送到 Axiom。由于该路径不经过 Collector，
producer 必须先执行字段白名单和清理。Cloudflare native invocation logs 和 native traces 保持
关闭，不能作为替代。

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

Agent trace 只允许 user/session 关联、model/provider、Agent/tool 名称、usage、阶段结果以及
`request_id`、`run_id`、`trace_id`、`turn_id`。prompt、模型输入输出、对话、工具原始载荷、
memory/retrieval 正文、provider 原始响应和认证材料不得进入运行 trace。

Langfuse dataset 是独立的显式评测生命周期，不能从生产 trace 正文自动生成。个人数据清除仍使用
Langfuse Public API 删除 Agent/runtime trace 和历史遗留 Hindsight trace；停止新 trace ingestion
不能删除这项隐私维护。

### 凭据

Axiom 保留现有两个逻辑 token 合同：

- `AXIOM_TERRAFORM_TOKEN`：平台资源管理；
- `AXIOM_RUNTIME_TOKEN`：现有运行时交付投影，供 Worker log destination 与 Ops Web logs query。

不新增 `AXIOM_WORKERS_LOGS_INGEST_TOKEN`，也不按 dataset、consumer 或 API 操作继续拆分 token。
现有 token 的宽权限不因删除信号而在本次修改中收窄。GitHub Secret、Kubernetes Secret 和进程
环境变量中的不同名称只表示交付位置；是否映射到同一上游 identity 由环境交付维护。

Sentry 同样沿用既有 provider token，不创建按 runtime 或 source-map consumer 拆分的新身份。
Langfuse trace ingestion key 与 execution-control personal-data maintenance key 对应不同调用协议，
但属于同一个 project 生命周期。

## 后果

- Axiom 成本只随有业务价值的 application events 增长，不再随节点数量和 scrape 周期增长；
- Langfuse 配额停收只降低 Agent trace 可见性，不影响在线业务、readiness 或产品终态；
- Ops Web 概览只回答产品请求状态，不把外部信号缺失推断成系统故障；
- Source 只维护 Agent trace producer 合同和本地 Collector，环境是否启用由环境仓决定；
- 删除最后一个消费者时，配置、schema、文档、测试、环境变量和网络权限必须一起删除。

## 未采用方案

- **保留无消费者 metrics/traces 以备未来使用**：持续产生供应商成本和错误告警语义。
- **让 Ops Web 成为通用 Axiom 或 Temporal 代理**：扩大高权限查询面并复制成熟平台。
- **要求 requestId 与 traceId 同时匹配日志**：会丢失只有 durable request key 的合法记录。
- **为每个数据集或消费者新建 token**：没有新的信任边界，只增加交付和轮换故障面。
- **用第二套存储作为观测故障回退**：重新引入重复数据路径和不一致状态。

## 相关文档

- `../architecture/system/ops-observability.md`
- `../architecture/system/langfuse.md`
- `../contracts/langfuse-runtime.md`
- `../runbooks/otel.md`
- `../runbooks/worker-otel.md`
- `adr-0072-self-hosted-ops-web.md`
- `adr-0076-langfuse-trace-data.md`
