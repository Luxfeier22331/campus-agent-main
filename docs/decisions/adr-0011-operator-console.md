---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0011
status: superseded
superseded_by: ADR-0080
---

# ADR-0011：Operator Console Worker 边界

## 原决策

本决策曾选择独立 Cloudflare Worker 作为受保护的运维浏览器，并要求它只代理 app-api
白名单接口，不直连 PostgreSQL、execution-control、Temporal 或观测平台。

## 取代

ADR-0080 已完全退役 Operator Console。仍成立的安全要求由 Ops Web 继承：Cloudflare Access
不能替代应用内准入，浏览器不能获得数据库、Provider Config admin 或观测平台凭据。

当前边界见 `docs/architecture/system/ops-observability.md` 和
`docs/decisions/adr-0080-operator-console-retirement.md`。
