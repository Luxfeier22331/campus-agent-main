---
doc_type: architecture
owner_boundary: apps/ops-web
status: active
---

# Ops Web 可观测性架构

## 文档范围

本文定义 `ops-web`、PostgreSQL、OpenTelemetry、OpenObserve、Temporal、Langfuse、
Sentry 和 Axiom 在运行排查中的职责。页面要求见 `../../product/ops-web.md`，HTTP 字段见
`../../contracts/ops-web.md`，模型配置边界见 `../../decisions/adr-0080-ops-web.md`。

本文不宣称 staging 已部署，也不记录环境地址、Secret 或资源规格；这些由环境 GitOps
仓库和实际运行证据负责。

## 核心结论

`ops-web` 是唯一自托管运维产品。它在服务端读取严格授权的 PostgreSQL 摘要并查询
OpenObserve，浏览器只访问同一进程的接口。明确允许的写能力包括模型服务配置、食堂内容、
固定内部门户 TGC 和固定认证维护 Schedule；每项能力使用独立 role、固定 Secret 或窄接口。

Ops Web 不是产品 API、数据库浏览器、Temporal 控制台、通用 Secret 管理器或通用日志平台。

## 数据流

```mermaid
flowchart LR
  Browser[值班人员浏览器]
  Access[Cloudflare Access]
  OpsWeb[ops-web 页面与服务端]
  Pg[(PostgreSQL 请求与运行摘要)]
  Control[execution-control 队列状态接口]
  Health[固定服务健康检查]
  OpenObserve[(OpenObserve)]
  PortalSecret[(固定内部门户 Secret)]
  ProviderDB[(Provider 候选与验证结果)]
  ProviderSecret[(Provider Config v2 Secret)]
  IngestionControl[ingestion-control 运维接口]
  AuthSchedule[Temporal 认证维护 Schedule]
  OTel[OpenTelemetry Collector]
  Runtime[应用运行时]
  TemporalUI[Temporal UI]
  LangfuseUI[Langfuse UI]
  Sentry[Sentry]
  Axiom[Axiom]

  Browser --> Access --> OpsWeb
  OpsWeb --> Pg
  OpsWeb --> Control
  OpsWeb --> Health
  OpsWeb --> OpenObserve
  OpsWeb -->|仅 get/patch 固定资源| PortalSecret
  OpsWeb --> ProviderDB
  OpsWeb -->|resourceVersion CAS| ProviderSecret
  OpsWeb -->|读取状态/恢复固定 Schedule| IngestionControl
  IngestionControl --> AuthSchedule
  Runtime --> OTel
  OTel --> OpenObserve
  OTel --> Sentry
  OTel --> Axiom
  OTel --> LangfuseUI
  OpsWeb -. 关联入口 .-> TemporalUI
  OpsWeb -. 关联入口 .-> LangfuseUI
  OpsWeb -. 关联入口 .-> Sentry
  OpsWeb -. 关联入口 .-> Axiom
```

图中的外部输出只表示对应环境配置了该输出；某个外部平台未启用时不影响请求状态读取。

## 组件职责

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| Ops Web 页面 | 展示、筛选、复制关联标识、打开入口和执行已准入运维操作 | 读取现有凭据或提交任意查询 |
| Ops Web 服务端 | Access 验证、固定查询、短缓存、读取审计、Provider Config 和固定 Secret patch | 写请求状态、触发任意工作流或提供通用代理 |
| ingestion-control | 读取固定 Schedule 与最近结果、幂等恢复该 Schedule | 接收任意 Schedule 或 Workflow 标识 |
| PostgreSQL | turn dispatch、用户问题、agent run、observability fact 和读取审计 | Temporal 队列、原始日志、原始调用链 |
| OpenTelemetry Collector | 接收、清理、批处理并发送观测数据 | 长期查询和请求状态判断 |
| OpenObserve | 保存并查询内网可用的日志、指标和调用链 | 决定产品请求成功或失败 |
| Temporal | 工作流历史、重试、超时、取消和任务队列真相 | Ops Web 请求状态或页面合同 |
| Langfuse | 受信任的模型调用 trace、评分、数据集和评测 | 产品请求状态数据库或工作流真相 |
| Sentry | 错误、异常和性能排查 | Ops Web 的内网原始记录来源 |
| Axiom | 外部日志、事件、查询、看板和告警 | Ops Web 的内网原始记录来源 |
| Hindsight | 由 execution-control Activities 调用的个人记忆服务 | Ops Web 浏览器或服务端查询接口 |

## 请求状态和关联

请求状态和排查摘要来自以下 PostgreSQL 来源：

- `chat.turn_dispatches`
- `chat.messages`
- `runtime.agent_runs`
- `runtime.request_observability_fact`

Ops Web 只获得这些来源中合同列出的列。OpenObserve、健康检查、Temporal、Langfuse、
Sentry 和 Axiom 只能补充排查信息，不能改写请求状态。

agent-runtime 通过 OpenInference、官方 Langfuse OTel processor 和标准 OTLP 输出 SDK
spans。受信任的 Langfuse trace 可以包含模型输入输出、授权的 retrieval facts 和 memory
context；这些正文不进入 PostgreSQL 摘要、OpenObserve、Sentry 或 Axiom。任何 sink 都不得
接收 credential、secret 或 Temporal history。

关联标识的用途：

- `requestId`：列表、详情和 OpenObserve 查询的主标识；
- `traceId`：同一次调用链的跨系统标识；
- `conversationId`：同一会话中的请求关联；
- `runId`：运行记录标识；
- `workflowId`：由 `runId` 按 `campus-agent.chat.<runId>` 生成的 Temporal 工作流标识。

缺少 `runId` 时不生成工作流标识，也不猜测其他 Temporal 字段。

## 运行概况

Ops Web 并行读取四类信息：

1. PostgreSQL 提供请求数量、状态、95% 耗时和趋势。
2. execution-control 通过 Temporal SDK 提供当前任务队列状态。
3. 固定健康检查提供五个服务的 HTTP 状态。
4. OpenObserve 提供日志、指标和调用链在所选时间窗口内的记录数与最近时间。

单个健康检查有独立超时。概况结果在每个进程内缓存 15 秒；PostgreSQL 和运行信号都失败时，
只允许使用五分钟内的最近成功结果并标为 `STALE`。该缓存不承担持久化或跨实例一致性。

## OpenTelemetry 和 OpenObserve

应用继续通过现有 OpenTelemetry 入口发送信号。环境中的 Collector 可以将同一批允许数据
同时发送到 OpenObserve 和已启用的外部平台。OpenObserve 不是从 Sentry 或 Axiom 回传数据，
因此外部平台不可访问时，内网仍可查询已写入 OpenObserve 的记录。

Collector 配置必须：

- 删除认证材料、Cookie、JWT、数据库地址、提示词和其他禁止字段；
- 为每个输出使用独立凭据；
- 批处理并进行有界重试；
- 暴露自身健康和发送失败信号；
- 不把调试输出重新采集回自身。

`diagnostics_json` 只能承载 compact operator summary：reason code、verdict、count、
latency/status、stable document id/title summary 与 `knowledge_search` target/history /
evidence shape。它不承载 query rewrite text、retrieval query text、raw filter payload、
source snippet 或 raw provider/tool diagnostics。

Ops Web 查询固定日志流、指标流和调用链流。浏览器只能选择日志或调用链；服务端从已保存
请求取得 `requestId` 和时间范围，应用 200/500 条上限，并在成功返回前写审计。

低流量窗口没有日志或调用链不自动表示故障。持续指标没有数据可视为采集链路降级。单个流
查询失败只影响该流；OpenObserve 整体不可用也不使 Ops Web Pod 退出就绪状态。

## Temporal、Langfuse 和外部平台

- Ops Web 调用 execution-control 的只读内部接口获取当前 Temporal 队列状态；该结果不落库。
- 完整工作流历史、重试、Signal、Update、Reset 和 Terminate 留在 Temporal UI。
- Ops Web 展示已保存的模型、提示词版本和安全关联标识，不查询 Langfuse 数据库。
- 模型 span、token、费用、评分、数据集和人工评审留在受信任的 Langfuse UI；产品数据库
  只保存 trace correlation，不复制 observation body 或 sink URL。
- Sentry 和 Axiom 只作为已配置的外部入口；Ops Web 不定时同步、不缓存其接口响应。
- 外部链接必须使用 HTTPS，并通过每个平台的服务端地址白名单校验。

## 权限和审计

### 浏览器访问

Cloudflare Access 负责登录和 JWT 签发，Ops Web 服务端再次验证签发方、受众、签名和
操作者白名单。原始日志和调用链使用更窄的独立白名单。

内部门户认证接口只允许基础白名单中的人员身份，不接受服务令牌。修改请求必须同源，正文
上限为 8 KiB；响应、日志、数据库和读取审计都不得包含 TGC。

### 集群权限

Ops Web 的 ServiceAccount 只可对 `source-collector-internal-portal-auth` 执行 `get` 和
`patch`。它不能创建、列举、删除 Secret，也不能修改其他资源。调用 ingestion-control 时
只能读取和恢复固定 `internal-portal-auth-maintenance` Schedule，不能选择 Schedule、立即
触发工作流或发送其他 Temporal 命令。

### 数据库权限

`ops_web` 账号拥有四个允许来源的列级读取权限，并只能向
`observability.ops_observability_read_audit` 插入。它不能读取、更新或删除审计记录，
不能访问其他业务表，也不能使用 owner 权限。

`ops_audit_maintenance` 账号只能执行固定的 180 天审计清理函数，不能直接访问审计表。
非本地 PostgreSQL 连接使用 CA 和 `verify-full` 验证证书链及主机名。

### OpenObserve 凭据

环境必须为以下用途分配不同凭据：

- OpenObserve 服务初始化；
- Collector 写入；
- Ops Web 读取；
- 保留期维护。

Ops Web 和 Collector 不得使用 root 凭据。环境尚未创建专用读取账号时，Ops Web 的
OpenObserve 查询保持不可用，但 PostgreSQL 摘要、门户认证维护和 `/readyz` 继续工作。不得
为了启用查询提交占位用户名、占位令牌或 root 密码。

## 故障边界

- PostgreSQL 失败：请求列表和详情返回错误，不能显示为空列表。
- OpenObserve 失败：原始记录和观测状态不可用，请求摘要仍可读取。
- 单个健康检查失败：该服务显示故障，其他服务继续展示。
- 审计写入失败：拒绝返回原始记录。
- Kubernetes API 或固定 Secret 不可用：门户认证页面返回明确错误，其他排查接口继续工作。
- ingestion-control 认证维护接口不可用：凭据仍可更新，维护状态显示不可用；显式恢复返回错误。
- 外部入口未配置：显示未配置，不影响本地排查。
- 外部输出失败：由 Collector 自身状态反映，不改写请求状态。

`/healthz` 只检查进程。`/readyz` 检查 Access 配置、PostgreSQL 读取和审计写入，不检查
OpenObserve、门户认证依赖或被观测服务。

## 部署边界

源码仓库拥有 `apps/ops-web`、镜像发布和 `infra/k8s/ops-web/base`。该 base 不选择
namespace、Ingress、ConfigMap、Secret 内容、NetworkPolicy、数据库角色或保留期任务；base
只声明固定 Secret 的资源名级 RBAC 和所需的受限 ServiceAccount token 投影。

环境 GitOps 仓库拥有这些环境事实，并以完整源码提交 SHA 引用 base、以镜像 digest 选择
`ops-web` 镜像。应用、OpenObserve、OTel、PostgreSQL 和 Secret 全部渲染成功仍不是上线证明；
实际可访问性和数据写入需要环境验证。

## 禁止形态

- 不让浏览器直连 PostgreSQL、OpenObserve、Temporal、Langfuse 或 Hindsight。
- 不让 Ops Web 服务端查询 Temporal、Langfuse 或 Hindsight 数据库。
- 不让浏览器传入任意 SQL、数据流、`traceId`、时间范围或记录上限。
- 不在 `app-api` 中保存 OpenObserve、Sentry、Axiom 或 Langfuse 查询结果。
- 不把 raw audit log、raw trace、raw event、raw LLM observation 或 SDK trace body 写入
  PostgreSQL read model。
- 不把 vendor-specific observability schema 写进 `packages/contracts`。
- 不恢复供应商正文同步任务或外部观测数据镜像表。
- 不把 Ops Web 做成通用管理后台、工作流控制台或外部平台复制品。
- 不允许 Ops Web 创建、列举、删除 Secret，或修改固定内部门户和 Provider Config 之外的 Secret。
- 不为 Ops Web 单独拆分一个只有它消费的后端服务。

## 相关文档

- `../../product/ops-web.md`
- `../../contracts/ops-web.md`
- `../../decisions/adr-0080-ops-web.md`
- `k8s-runtime.md`
- `langfuse.md`
- `../../contracts/stage-timing.md`
- `../../reference/telemetry.md`
- `../../decisions/adr-0067-ops-index-external-sinks.md`
- `../../decisions/adr-0074-repository-boundary.md`
- `../../decisions/adr-0072-self-hosted-ops-web.md`
