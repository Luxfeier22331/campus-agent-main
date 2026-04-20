---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-20
---

# Identity / Authz / Memory Domain

## 先看什么

- 架构总边界：`../architecture/identity-and-authorization-architecture.md`
- 产品/runtime owner split：`../architecture/product-runtime-architecture.md`
- 当前 merged truth：`../architecture/current-architecture.md`
- 通用执行态入口：`README.md`

## 长期边界与决策

- `../architecture/identity-and-authorization-architecture.md`
- `../decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `../decisions/adr-0022-campus-identity-and-restricted-document-authorization.md`
- `../decisions/adr-0034-authorization-model-and-retrieval-filter-projection.md`

## Contract 与 Data

- `../contracts/app-api-http.md`
- `../contracts/app-api-supervisor-execution.md`
- `../data/app-api-schema.md`

## 执行路由

- 当前 merged truth 统一看 `../architecture/current-architecture.md` 与 `../architecture/identity-and-authorization-architecture.md`
- 当前 pending work 统一看 `README.md` 定义的通用执行态入口，以及 `../../.planning/workstreams/restricted-document-rollout-verification/STATE.md`
- foundation 文档只保留为关闭态基线；restricted rollout、legacy ACL sunset 与后续 memory productization 统一从下面的 follow-up 入口进入

## Deferred Follow-up Plans

- `../plans/restricted-document-rollout-and-verification.md`
- `../plans/legacy-acl-carrier-compatibility-sunset.md`

## 相关领域

- `operator-observability.md`
  - operator panel 只消费 app-owned authz / audit / quality projections
