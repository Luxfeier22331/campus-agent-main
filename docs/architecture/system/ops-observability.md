---
doc_type: architecture
truth_scope: ops
owner_boundary: app-api
status: active
created: 2026-04-02
updated: 2026-06-30
---
# Ops Index And External Sinks Architecture

## 文档边界

本文冻结 Operator Console 在线值班观测的最小架构口径。

它回答：

- `app-api` 应该保存哪些最小运维索引
- `operator-console-web` 如何消费这些索引
- `Sentry`、`Axiom`、`Langfuse` 与 repo-owned runtime 各自负责什么
- 为什么不在 `app-api` 中复制外部 dashboard、trace、log、score 或 eval 明细

它不负责：

- 具体 dashboard 布局
- alert threshold、retention、sampling ratio
- sink SDK 或 Collector 的逐字段接入，见
  `docs/reference/runtime-otel-telemetry-taxonomy.md`
- eval 平台细节，见 `docs/architecture/system/langfuse.md`

## Core Conclusion

Operator Console 的当前和目标观测面固定为：

```text
operator browser
-> operator-console-web
-> app-api Ops Index
-> external sink links / native sink UI
```

`apps/app-api` 不是 observability platform。它只拥有产品运行所需的最小 Ops
Index：

- request identity：`requestId`、`traceId`、`conversationId`、`runId`
- request state：`surface`、`status`、`errorCode`、`startedAt`、`completedAt`
- runtime health summary：执行平面 ready/degraded/blocker 摘要
- sink correlation：能让 operator 跳到 Sentry / Axiom / Langfuse 的关联 ID 或链接模板

`Sentry`、`Axiom`、`Langfuse` 是详细观测 truth：

- Sentry：错误、异常、性能 tracing、release-aware debugging
- Axiom：日志、事件、长窗口查询、dashboard、monitor
- Langfuse：LLM trace、session、observation、dataset、eval、score、annotation workflow

因此 `app-api` 不保存外部平台的 raw dashboard 查询结果、raw event、raw trace、raw
LLM observation、raw score 或 raw issue body。

## Current Operator Surface

当前 `operator-console-web` 只暴露：

- `请求与运行`
- `模型服务配置`

当前观测面只回答值班最低问题：

- 最近请求是否成功、失败、取消或被拒绝
- 当前执行平面是否 ready / degraded
- 失败请求的 `requestId`、`traceId` 与 `errorCode`
- 是否存在可跳转到外部 sink 的关联入口

当前不开放：

- standalone audit workspace
- online quality dashboard
- online safety dashboard
- online cost dashboard
- intent drift dashboard
- badcase / eval candidate / release evidence 在线面板
- external sink mirror

这些内容如未来重新进入产品面，必须先有明确 operator workflow、current app-api
contract、Worker allowlist、UI 实现和验收测试。默认不能因为代码里存在历史 route 或表，就把它们写成 active surface。

## App-Owned Ops Index

`app-api` 允许保存的最小索引字段族：

- request correlation：`request_id`、`trace_id`、`conversation_id`、`run_id`
- product surface：`surface`、`principal_type`
- request state：`status`、`error_code`、`started_at`、`completed_at`、`duration_ms`
- product summary：`question_preview`、`answer_preview`、bounded `diagnostics_json`
- runtime health：ready/degraded/blocker reason code summary
- sink correlation：Sentry/Axiom/Langfuse 查询所需的 safe ID、URL template
  output 或 dashboard entry metadata

这些字段的用途是产品值班和跳转定位，不是复刻外部观测平台。

禁止保存：

- raw prompt
- raw answer
- raw transcript
- raw auth material、JWT、cookie、secret、token
- raw retrieval payload、support snippet dump 或 raw provider response
- raw log body
- raw trace body
- raw Sentry event / issue body
- raw Axiom dashboard query result
- raw Langfuse trace / observation / score / annotation body
- raw Temporal history
- local artifact path、object bucket/key，除非有独立 contract 明确允许

## External Sink Boundary

Runtime 边界通过 OTel / SDK / Collector 把 sanitized telemetry 送入 sink。Operator
Console 不把 sink 当作 route-time database。

### Sentry

Sentry 负责错误、异常、性能和跨 Worker tracing。Operator Console 可以展示 Sentry
deep link 或查询提示，但不从 Sentry 拉取 issue/event 明细后再落库。

### Axiom

Axiom 负责日志、事件、查询、dashboard 和 monitor。Operator Console 可以展示 Axiom
view/query 入口，但不缓存 Axiom dashboard 结果作为 app-api read model。

### Langfuse

Langfuse 负责 LLM trace、session、observation、dataset、score 和 annotation workflow。
`packages/eval-langfuse` 可与 Langfuse 平台同步 dataset / score；Operator Console
只消费 repo-owned 最小索引和必要的 safe correlation，不查询 Langfuse trace body。

## Access Model

外部平台权限优先由平台自身 RBAC 承担：

- Sentry 使用 organization/team membership 和 role 管理访问。
- Axiom 使用 role / dashboard / dataset / view 权限管理访问。
- Langfuse 使用 organization / project RBAC 管理访问。

repo 不用高权限 service token 抓取三家平台的数据，再通过 Operator Console 重新分发。
这会绕过外部平台权限模型，也会让 `app-api` 变成影子观测平台。

如果未来必须支持“operator 没有外部平台账号也能值班”，只能新增 curated summary：

- fixed allowlist fields only
- aggregated status/count/last-seen only
- no raw event/log/trace/LLM body
- no dashboard mirror
- no per-sink high-cardinality explorer

该能力必须以独立 backlog / contract 进入，不能复用当前 broad audit、quality、cost 或
safety 历史口径。

## Runtime Health

`Runtime Health` 的固定路径是：

```text
operator browser
-> operator-console-web explicit proxy
-> app-api /api/operator/runtime/health
-> execution-control /readyz projection
```

规则：

- Operator Console 不直接访问 `apps/execution-control`、Temporal service、Prometheus、
  Sentry、Axiom、Langfuse 或 PG。
- `app-api` 可以把 execution-control `/readyz` 的 structured payload 转成最小
  operator-safe runtime health summary。
- 缺配置、网络错误、鉴权错误、非 JSON 或非 readyz projection 错误仍 fail closed。
- Runtime health summary 只展示 reason-code 级别的 blocker，不展示 raw Temporal history
  或 worker 内部 payload。

## Retired Broad Observability Shape

以下历史概念不再是 target architecture：

- `operator quality dashboard`
- `operator safety dashboard`
- `operator cost dashboard`
- `operator intent dashboard`
- `standalone audit workspace`
- `trace backlink projection` 作为默认持久表
- `quality grade projection` 作为 Operator Console 当前 read model
- `badcase / eval candidate / release evidence` 在线面板
- app-api-owned Sentry/Axiom/Langfuse dashboard cache

如果代码或 schema 中仍存在这些名字，它们只能作为 current-code residue 或后续清理对象，
不得被新文档引用为目标态。

## Data Minimization

Ops Index 只保存值班必须字段：

- identity
- status
- reason code
- bounded preview
- latency / duration
- minimal runtime health
- safe sink correlation

所有更详细的调试、查询、趋势、LLM 质量分析和人工复核 workflow，默认回到
Sentry / Axiom / Langfuse 原生平台。

## Forbidden Shapes

- 不把 Operator Console 做成 Sentry、Axiom 或 Langfuse 的嵌入式 viewer。
- 不在 app-api 中保存外部 dashboard 内容。
- 不让 Operator Console route-time 查询 external sink。
- 不让 execution-control 承担 operator observability query backend。
- 不把 raw audit log、raw trace、raw event、raw LLM observation 变成 app-api read model。
- 不把 vendor-specific schema 写进 `packages/contracts`。

## 相关稳定文档

- `docs/contracts/app-api/observability.md`
- `docs/architecture/system/operator-console.md`
- `docs/architecture/system/langfuse.md`
- `docs/reference/runtime-otel-telemetry-taxonomy.md`
- `docs/runbooks/worker-observability-smoke.md`
- `docs/decisions/adr-0063-ops-index-external-sinks.md`

## 外部参考

- Sentry organization membership and roles:
  <https://docs.sentry.io/organization/membership/>
- Axiom role-based access control:
  <https://axiom.co/docs/reference/settings>
- Axiom views access:
  <https://axiom.co/docs/query-data/views>
- Langfuse RBAC:
  <https://langfuse.com/docs/administration/rbac>
