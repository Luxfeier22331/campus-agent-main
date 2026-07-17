---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0055
status: superseded
superseded_by: ADR-0080
---

# ADR-0055：统一 Operator Console

## 原决策

本决策曾试图把供应商配置、业务操作和运维投影统一到一个 Operator Console 产品，并让
app-api 成为 operator API、准入和投影后端。

## 取代

ADR-0080 已退役该产品与实现。Ops Web 是唯一运维浏览器；在线 Provider Config 由
execution-control 拥有，采集生命周期由 ingestion-control 拥有。app-api 不保留 operator、
provider、采集 ledger 或兼容路由。

当前边界见 `docs/decisions/adr-0080-operator-console-retirement.md` 和
`docs/architecture/system/product-runtime.md`。
