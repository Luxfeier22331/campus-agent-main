---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0081
status: accepted
partially_supersedes:
  - ADR-0010
  - ADR-0072
---

# ADR-0081：收敛可观测数据面并退役 OpenObserve

## 背景

OpenObserve 与 Axiom 同时承担通用日志、指标和调用链，会复制采集、保留、查询、权限与告警
能力。Ops Web 读取 OpenObserve 的设计又使值班路径依赖一套没有独立产品价值的第二存储。

Sentry、Axiom 和 Langfuse 的数据边界并不相同：Sentry 需要 SDK 原生的错误上下文、release 与
source map；Axiom 需要经过白名单清理的运行日志、调用链和指标；Langfuse 需要受信任的模型、
工具和记忆 trace。把三类数据无差别扇出会扩大敏感信息范围，也无法建立可验证的保留与删除
合同。

## 决策

### 平台分工

- Axiom 是通用运行日志、调用链、指标、固定查询、看板和告警的数据面。Ops Web 通过服务端
  固定 APL 查询 Axiom，不提供任意查询代理。
- Sentry 只通过应用或浏览器 SDK 接收错误、异常、受控性能数据、release 和 source map。
  OpenTelemetry Collector 不再向 Sentry 导出。
- Langfuse 是受信任的 LLM 与记忆 trace、dataset、score 和 annotation 数据面。每个环境只有
  一个 project，Agent runtime 与 Hindsight 通过 `service.name` 和固定 tag 区分。
- PostgreSQL 继续保存产品状态和有界诊断投影；Temporal 继续保存 workflow history、重试、
  timer 和 task queue 真相。任何观测平台都不能改写这些状态。
- OpenObserve 不再是运行依赖、查询面或回滚路径。环境中的资源删除必须在替代链路通过
  staging 门禁后以独立破坏性变更执行。

### Collector 边界

Collector Gateway 使用四个固定端口的 OTLP/HTTP 入口：通用运行信号、execution-control 编排
信号、Agent 受信任 trace 和 Hindsight 受信任 trace。每个入口使用精确网络权限，只路由到其
允许的数据面；集群内不再叠加没有独立信任边界的 bearer token。

Collector Agent 以 DaemonSet 采集第一方容器日志和 kubelet 指标，排除 Collector 与 Hindsight
stdout，清理后转发到 Gateway。Gateway 对 Axiom 数据使用明确字段白名单、采样、批处理、内存
发送队列和 300 秒重试上限；对受信任 Langfuse trace 只删除 credential 类属性。

execution-control 调用 Hindsight 时传播 W3C `traceparent` 与 `baggage`，并创建固定父 span
`memory.call`。该父 span 只记录 provider 和 HTTP method，不记录 URL、bank、document 或记忆
正文。

### Cloudflare application log 例外

app-api 与 campus-web Worker 只把 producer 已按字段白名单清理的 application console logs 通过
环境选择的 OpenTelemetry log destination 直接写入 Axiom。这条路径不经过仓库 Collector 的属性
白名单，因此必须使用 `persist=false`，并在 staging 用包含 query、header、正文、用户标识和
credential 哨兵值的请求验证实际下游 payload。

Worker 必须设置 `invocation_logs=false` 和 `observability.traces.enabled=false`。Cloudflare
invocation log 与 native trace 不是本系统的观测证据；请求级调用链由传入 execution-control 的
W3C context 关联，并以 Collector 写入 Axiom/Langfuse 的 runtime trace 为证据。

只有 application log 的允许事件可查询、全部哨兵为零匹配，且 Axiom 中没有同一请求的
invocation log 或 native trace，才可以继续 OpenObserve 退役。检查失败时必须先关闭 application
log destination 或对应 producer 输出；出现 invocation log/native trace 则按配置漂移处理。不得把
Collector 白名单当作 application log 旁路的保护。

### 权限与生命周期

- Axiom 的 log、trace 和 metric 使用不同 dataset 和同一枚 ingest token；Ops Web 使用单独的
  query-only token，不使用 personal token 或写入 token。
- Sentry browser 与 edge DSN 分开配置；构建发布 source map 时使用独立 CI credential，运行时
  不持有该 credential。
- Langfuse runtime 与 Hindsight 使用环境唯一 project 的同一组写入和维护凭据。个人记忆 owner erase 必须按产品
  `UserID` 与 `command.source_updated_at` 上界精确删除 runtime trace，并按已做 owner-salt 派生
  的已退役 bank `langfuse.user.id` 精确清空 Hindsight trace；异步删除后必须按相同边界复查。
- credential、Cookie、JWT、数据库地址、原始用户问题、回答、检索正文和记忆正文不得进入
  Axiom 或 Sentry。Langfuse 可以按 ADR-0076 保存受信任模型诊断正文，但仍不得保存认证材料。

## 后果

- Ops Web 的运行概况与请求原始记录只查询 Axiom；Axiom 故障不影响 PostgreSQL 请求摘要或
  Ops Web readiness。
- 运行时不再维护手写的 Worker OTLP exporter；Cloudflare application log destination 与 Sentry
  SDK 各自拥有其平台集成，Worker native trace 保持关闭。
- OpenObserve 的数据库、角色、Secret 和对象存储资源没有长期兼容义务，但实际删除必须与
  首次观测链路发布分开，并在删除前保留可核验的 staging 证据。
- 源码配置、Terraform plan、manifest render 或 Secret 名称存在都不证明下游已收到数据；上线
  事实仍由环境 revision 和真实查询证明。

## 未采用方案

- **保留 OpenObserve 作为内网副本**：重复 Axiom 的存储、查询、权限、保留与值班链路。
- **Collector 同时向 Sentry 和 Axiom 发送全部 trace**：绕过 Sentry SDK 语义并增加重复与正文
  扩散风险。
- **所有信号直接从应用写供应商**：会复制认证、字段清理、采样和重试逻辑；仅保留平台原生
  能力确实要求的例外。
- **让 Ops Web 成为通用 Axiom 代理**：会把高权限查询能力与任意 APL 暴露给浏览器。
- **用 OpenObserve 作为失败回滚路径**：会让已退役平台重新成为运行依赖。

## 与既有决策的关系

本文只取代 ADR-0010 中“OpenObserve 保存通用信号”和 Collector 向 Sentry 通用分发的部分，
保留其 OpenTelemetry 关联、数据正文边界与产品真相分离要求。本文也取代 ADR-0072 中 Ops Web
查询 OpenObserve 的部分；ADR-0072 的自托管 BFF、访问控制、读取审计和固定操作边界继续有效。

## 相关文档

- `../architecture/system/ops-observability.md`
- `../architecture/system/langfuse.md`
- `../runbooks/otel.md`
- `../runbooks/gitops.md`
- `adr-0010-observability.md`
- `adr-0072-self-hosted-ops-web.md`
- `adr-0076-langfuse-trace-data.md`
- Axiom OpenTelemetry：<https://axiom.co/docs/send-data/opentelemetry>
- Cloudflare Workers OpenTelemetry：
  <https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/>
- Sentry Cloudflare SDK：<https://docs.sentry.io/platforms/javascript/guides/cloudflare/>
- Langfuse 数据删除：<https://langfuse.com/docs/data-deletion>
