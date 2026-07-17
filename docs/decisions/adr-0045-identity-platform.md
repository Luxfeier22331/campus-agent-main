---
doc_type: decision
owner_boundary: docs/decisions
decision_id: ADR-0045
status: superseded
superseded_by: ADR-0080
---

# ADR-0045：身份平台

## 原决策

本决策曾在 Better Auth 之外建立 app-api `identity.*` 产品表和一组账号、身份、权限、偏好投影。
它试图隔离认证库内部结构，但同时扩大了 app-api 的影子身份所有权。

## 取代

Operator Console 退役清理删除了未上线的 `identity.*` schema 与对应 HTTP 投影，不迁移、不双写、
不保留兼容读取。app-api 继续拥有 Better Auth、`GET /api/me`、联邦协议和个人记忆产品接口；
执行链只消费准入时冻结的最小 principal/authz。

当前边界见 `docs/architecture/system/identity-authz.md`、
`docs/architecture/system/identity-browser.md` 和 `docs/contracts/app-api/auth.md`。
