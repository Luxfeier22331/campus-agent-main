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

系统需要关联 Cloudflare Workers、自托管服务、Temporal workers 和模型运行时，但产品状态、
工作流历史、通用运行信号、应用错误和模型观测具有不同权限、保留期与查询方式。

Sentry、Axiom 和 Langfuse 的职责也不相同：Sentry 需要 SDK 原生的错误上下文、release 与
source map；Axiom 需要经过白名单清理的运行日志、调用链和指标；Langfuse 需要受信任的模型、
工具和记忆 trace。把三类数据无差别扇出会扩大敏感信息范围，也无法建立可验证的保留与删除
合同。

## 决策

### 平台分工

- Axiom 保存清理后的通用运行日志、调用链和指标，并提供查询、看板与告警；
- Sentry 通过应用或浏览器官方 SDK 保存错误、异常、受控性能、release 和 source map；
- Langfuse 保存受信任的模型、工具和记忆调用链，以及数据集、评分和人工评审；
- PostgreSQL 保存产品状态和有界诊断投影；Temporal 保存工作流历史、重试、计时器和任务队列
  状态；
- Ops Web 只执行服务端固定查询并提供外部入口，不复制平台正文或提供任意查询代理；
- 任何观测平台都不能改写产品状态或工作流状态。

W3C Trace Context 和稳定的产品关联标识连接这些平台。供应商字段不能进入领域合同，原生调用链
标识也不能被产品标识覆盖。

### Collector 边界

OpenTelemetry Collector 为不同信任级别的运行信号提供独立 receiver、网络边界和路由。通用运行信号经过字段
白名单、清理、采样和批处理后进入 Axiom；受信任的 Agent 与 Hindsight 调用链可以进入
Langfuse，但必须删除认证材料。集群内入口不重复增加 bearer token；不同来源不能获得可绕过
NetworkPolicy、处理器或输出规则的网络权限。

节点级 Collector 采集第一方容器日志和基础指标，集中式 Collector 执行跨服务路由与发送。
execution-control 调用 Hindsight 时传播标准调用链上下文，并创建不含原始用户标识、记忆正文、
文档标识或供应商地址的父 span。精确入口、属性和发送配置由可执行 Collector 配置维护。

### Cloudflare application log 例外

Cloudflare Worker 使用平台支持的日志目标和 Sentry 集成。由于平台日志不经过仓库 Collector，
生产者必须在发送前执行字段白名单和清理，不能把 Collector 规则当作保护。平台原生调用日志或
调用链不能替代 execution-control 运行时产生的请求级调用链。精确平台开关和验证步骤由
`worker-otel.md` 维护。

### 权限与生命周期

- 各平台按写入、查询、构建发布和维护职责使用独立的最小权限凭据，不复用个人凭据或运行时
  写入凭据；
- 日志、调用链、指标、错误和模型观测按用途设置数据集合、访问权限与保留期；
- 每个环境使用单一 Langfuse project，生产者通过独立 receiver、NetworkPolicy、来源属性和固定
  tag 隔离；
- 账号清除必须按稳定产品身份和记忆代次删除对应 Langfuse 数据，并在异步删除完成后复查；
- credential、Cookie、JWT、数据库地址、原始用户问题、回答、检索正文和记忆正文不得进入
  Axiom 或 Sentry。Langfuse 可以按 ADR-0076 保存受信任模型诊断正文，但仍不得保存认证材料。

## 后果

- Ops Web 的运行概况与请求原始记录只查询 Axiom；Axiom 故障不影响 PostgreSQL 请求摘要或
  Ops Web readiness。
- Cloudflare 平台集成与 Collector 各自维护适合其运行时的数据路径，不在应用中重建通用发送器；
- 平台故障只能降低对应观测能力，不能改变在线请求执行结果。

## 未采用方案

- **维护第二套通用日志与调用链存储**：重复 Axiom 的存储、查询、权限、保留与值班链路。
- **Collector 同时向 Sentry 和 Axiom 发送全部 trace**：绕过 Sentry SDK 语义并增加重复与正文
  扩散风险。
- **所有信号直接从应用写供应商**：会复制认证、字段清理、采样和重试逻辑；仅保留平台原生
  能力确实要求的例外。
- **让 Ops Web 成为通用 Axiom 代理**：会把高权限查询能力与任意 APL 暴露给浏览器。
- **把第二套存储作为故障回退**：会重新引入重复的运行依赖和运维链路。

## 相关文档

- `../architecture/system/ops-observability.md`
- `../architecture/system/langfuse.md`
- `../runbooks/otel.md`
- `../runbooks/worker-otel.md`
- `adr-0072-self-hosted-ops-web.md`
- `adr-0076-langfuse-trace-data.md`
- Axiom OpenTelemetry：<https://axiom.co/docs/send-data/opentelemetry>
- Cloudflare Workers OpenTelemetry：
  <https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/>
- Sentry Cloudflare SDK：<https://docs.sentry.io/platforms/javascript/guides/cloudflare/>
- Sentry Issues API：<https://docs.sentry.io/api/events/list-an-organizations-issues/>
- Sentry API 权限：<https://docs.sentry.io/api/permissions/>
- Axiom JavaScript SDK：<https://github.com/axiomhq/axiom-js>
- Axiom Correlations：<https://axiom.co/docs/query-data/correlations>
- Langfuse 数据删除：<https://langfuse.com/docs/data-deletion>
