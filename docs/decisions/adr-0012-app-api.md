---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0012
status: superseded
superseded_by: ADR-0080
---

# ADR-0012：共享 App API

## 原决策

本决策曾把 Campus Web 与 Operator Console 的认证、产品数据、配置和业务操作统一放入
app-api，以避免浏览器界面各自建设后端。

## 取代

ADR-0080 删除了 Operator Console 以及 app-api 的 operator/provider runtime。app-api 继续作为
Campus Web 的产品后端，拥有浏览器认证、会话、聊天和个人记忆产品生命周期；在线 Provider
Config、采集控制和运维诊断分别归 execution-control、ingestion-control 与 Ops Web。

当前边界见 `docs/architecture/system/product-runtime.md`。
