---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-12
---

# Identity / Authz / Memory Domain

## 先看什么

- 架构总边界：`../architecture/identity-and-authorization-architecture.md`
- 产品/runtime owner split：`../architecture/product-runtime-architecture.md`
- 当前 merged truth：`../architecture/current-architecture.md`
- 当前项目执行真相：`../../.planning/PROJECT.md`
- 当前 workstream registry：`../../.planning/WORKSTREAMS.md`

## 长期边界与决策

- `../architecture/identity-and-authorization-architecture.md`
- `../decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `../decisions/adr-0022-campus-identity-and-restricted-document-authorization.md`
- `../decisions/adr-0034-authorization-model-and-retrieval-filter-projection.md`

## Contract 与 Data

- `../contracts/app-api-http.md`
- `../contracts/app-api-supervisor-execution.md`
- `../data/app-api-schema.md`

## 当前执行说明

- 当前 merged truth 已明确 `apps/app-api` 是 canonical identity / authz / profile memory / session memory owner
- execution path 只消费 typed projection；retrieval path 只消费 authz filter projection，不恢复最终授权真相
- Phase 11 foundation 已关闭；restricted rollout、memory productization、legacy ACL sunset 仍有后续工作，但这些是 productization gap，不是 owner 未定
- 判断当前 pending work 时优先看 `../../.planning/PROJECT.md`、`../../.planning/WORKSTREAMS.md` 与 `../../.planning/workstreams/restricted-document-rollout-verification/STATE.md`，不要把旧 foundation plan 误读成当前 merged truth

## Completed Foundation Plans

- `../plans/intent-memory-acl-foundation.md`
- `../plans/campus-identity-and-restricted-document-foundation.md`

## Deferred Follow-up Plans

- `../plans/restricted-document-rollout-and-verification.md`
- `../plans/legacy-acl-carrier-compatibility-sunset.md`

## 相关领域

- `operator-observability.md`
  - operator panel 只消费 app-owned authz / audit / quality projections
