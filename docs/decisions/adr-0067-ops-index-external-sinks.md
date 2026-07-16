---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0067
status: accepted
---
# ADR-0067 Ops Index 与外部观测平台

## 背景

仓库使用 Sentry 处理 error/trace，Axiom 处理 log/event/query dashboard，Langfuse 处理 LLM
trace、dataset、score 和 review workflow。

旧 operator observability 文档提出由 app-api 保存大范围 audit、quality、safety 和 cost
read model。这会重复外部平台、扩大数据库范围，并把 Operator Console 变成自研观测产品。

## 决策

采用 `Ops Index + External Sinks`：

- `apps/app-api` 只保存产品排查所需的最小 Ops Index：request identity、status、error code、
  timing、runtime health summary 和安全 sink correlation。
- Sentry、Axiom 和 Langfuse 保存各自详细观测事实。
- Operator Console 可以展示安全链接或 dashboard 入口，但不得把 external dashboard data、
  raw sink event、raw trace 或 raw LLM observation 复制进 app-api。
- 外部平台访问使用各平台 RBAC；仓库不得用高权限 service token 通过 Operator Console
  重新分发 sink data。
- 未来如需让没有外部平台账户的 operator 查看摘要，必须新增 allowlisted curated-summary
  contract，不能恢复大范围 audit/quality/safety/cost model。

## 后果

- broad operator quality、safety、cost、intent 和 standalone audit endpoint 不是目标架构。
- 仍使用这些名称的 code/schema 是待删除或收窄的残留，不代表目标能力。
- Operator Console 是产品运维界面，不嵌入 Sentry/Axiom/Langfuse viewer。
- app-api 不成为 Langfuse score 或 trace database。
- smoke 验证 sink 能收到并通过 request/trace id 关联数据，不验证 app-api 是否保存 dashboard
  正文。

## 未采用方案

- **保留宽泛 app-api projection**：会复制外部平台并固定所有 dashboard 字段。
- **镜像外部 dashboard**：会绕过 RBAC 并产生过期缓存。
- **完全只提供链接**：产品仍需说明哪次请求失败以及使用哪个 correlation id。
