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

### Sentry project 边界

staging 只使用一个 canonical Sentry project `campus-agent-workers`。app-api edge、Campus Web
browser/edge、release 和 source map 通过既有的 per-surface 变量接口投影到同一个 project/key；变量
名的 surface 区分用于发布合同，不代表远端 project 隔离。这样与当前 Sentry 订阅和实际运维边界
一致，也避免为每个 Worker 维护重复的 project、key、查询和生命周期。

GitOps 在 `6bd0500`（2026-07-19）首次引入两个 staging project，`2f262b3`（2026-07-21）又
调整了 key/DSN 投影；这段历史只说明仓库配置何时分裂，不能反推最初远端 Sentry project 的数量。
收敛时用 Terraform `import` 接管已存在的 canonical project/key，并在受保护的同一份 plan 中正常
删除旧资源。Terraform `removed { destroy = false }` 或 `forget` 只改变 state 归属，不执行远端删除，
因此不属于本合同。

### 拓扑约束

长期目标和当前 staging 都采用两个角色：Agent DaemonSet 负责节点日志和 kubelet metrics，
Gateway Deployment 提供受控 OTLP 入口、字段清理、路由与下游发送。Agent 与 Gateway 的职责边界
不是待完成的合并迁移；当前资源、端口、网络和启用状态以环境仓的可执行 values 与 Application
清单为准。

### Collector 边界

OpenTelemetry Collector 为不同信任级别的运行信号提供独立 receiver、网络边界和路由。通用运行信号经过字段
白名单、清理、采样和批处理后进入 Axiom；受信任的 Agent 与 Hindsight 调用链可以进入
Langfuse，但必须删除认证材料。集群内入口不重复增加 bearer token；不同来源不能获得可绕过
NetworkPolicy、处理器或输出规则的网络权限。

每个 Kubernetes 节点运行一个 Agent DaemonSet 实例，采集第一方容器日志和基础指标并把信号发送到
Gateway；Gateway Deployment 为工作负载提供固定 OTLP 入口、字段清理、路由与发送。
execution-control 调用 Hindsight 时传播标准调用链上下文，并创建不含原始用户标识、记忆正文、
文档标识或供应商地址的父 span。精确入口、属性和发送配置由可执行 Collector 配置维护。

### Cloudflare application log 例外

Cloudflare Worker 使用平台支持的日志目标和 Sentry 集成。由于平台日志不经过仓库 Collector，
生产者必须在发送前执行字段白名单和清理，不能把 Collector 规则当作保护。平台原生调用日志或
调用链不能替代 execution-control 运行时产生的请求级调用链。精确平台开关和验证步骤由
`worker-otel.md` 维护。

当前合同关闭 Cloudflare native invocation logs 和 native traces。Native trace 只提供边缘 handler、
fetch、binding、colo、Worker version 以及 CPU/wall-time 等补充信号，且自动属性可能包含 URL/query、
header、R2 key 或数据库元数据；直投 Axiom 会绕过 Collector 白名单并与现有产品 trace 重复。若未来
需要重新启用，必须另行评审数据边界、字段白名单、目标和保留期，不能通过单独打开 Worker 开关恢复。

### 权限与生命周期

- Axiom 与 Sentry 分别只维护一枚覆盖当前可信调用面的非个人供应商 token，不按 dataset、消费者
  或 API 操作机械拆分；
- Axiom token 由 Terraform、Collector 与 Ops Web 共用，覆盖平台资源管理、当前 dataset 的
  Query 与 Ingest；Sentry token 由 Terraform、release/source map 上传与 Ops Web 共用；
- GitHub Secret、Kubernetes Secret 与进程环境变量中的不同名称只表示交付位置或消费接口，不表示
  不同上游身份；同一供应商 token 的所有投影属于同一轮换单元；
- 日志、调用链、指标、错误和模型观测按用途设置数据集合、访问权限与保留期；
- 所有环境共用 Langfuse Cloud Japan 区域中的 `campus-agent` project，通过原生 `environment`、
  独立 receiver、NetworkPolicy、来源属性和固定 tag 隔离；
- 账号清除必须按稳定产品身份和记忆代次删除对应 Langfuse 数据，并在异步删除完成后复查；
- credential、Cookie、JWT、数据库地址、原始用户问题、回答、检索正文、记忆正文和工具原始
  载荷不得进入任何运行 trace；Langfuse 按 ADR-0076 只保存受控模型/用量/关联元数据。

## 后果

- Ops Web 的运行概况与请求原始记录只查询 Axiom；Axiom 故障不影响 PostgreSQL 请求摘要或
  Ops Web readiness。
- Cloudflare 平台集成与 Collector 各自维护适合其运行时的数据路径，不在应用中重建通用发送器；
- Axiom 与 Sentry 各自只维护一个供应商身份，减少重复配置、轮换工作和凭据不一致导致的故障；
- 平台故障只能降低对应观测能力，不能改变在线请求执行结果。

## 未采用方案

- **维护第二套通用日志与调用链存储**：重复 Axiom 的存储、查询、权限、保留与值班链路。
- **Collector 同时向 Sentry 和 Axiom 发送全部 trace**：绕过 Sentry SDK 语义并增加重复与正文
  扩散风险。
- **所有信号直接从应用写供应商**：会复制认证、字段清理、采样和重试逻辑；仅保留平台原生
  能力确实要求的例外。
- **让 Ops Web 成为通用 Axiom 代理**：会把高权限查询能力与任意 APL 暴露给浏览器。
- **把第二套存储作为故障回退**：会重新引入重复的运行依赖和运维链路。
- **按消费者或 API 角色拆分 Axiom、Sentry token**：当前 CI 与服务端消费者处于同一可信运维
  边界，拆分不会满足新的产品或安全合同，只会增加凭据数量、轮换工作和配置不一致故障面。

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
