---
doc_type: roadmap
status: active
created: 2026-04-19
updated: 2026-04-20
---

# Roadmap: Operator Observability Control Plane

## Overview

这条 workstream 已于 `2026-04-20` 恢复为 active。
为避免字母 phase 与当前 GSD workstream 语境混淆，roadmap 统一改为数字 phase。

当前 merged truth 已经吸收了前三段后端基础：

- `Phase 1` 对应原 `Phase A`
- `Phase 2` 对应原 `Phase B`
- `Phase 3` 对应原 `Phase C`
- `Phase 11` 已完成；当前 active frontier 前推到 `Phase 12`，进入 staging smoke / closeout

## Phases

- [x] **Phase 1: Request-scoped Observability Foundation** — merged truth 已具备 `runtime.request_observability_fact`、request observability detail、trace backlink safe summary 与 request-level observability persistence，不再从零开始。
- [x] **Phase 2: Audit Projection** — merged truth 已具备 `operator.request_audit_projection` 与 `GET /api/operator/audit` / `GET /api/operator/audit/:auditEventId` seam；panel `Audit` 域仍未消费它，但后端投影基础已成立。
- [x] **Phase 3: Metric Rollup And Aggregate APIs** — 已完成 `safety/anomalies` 与 `cost/timeseries` 的 `app-api` route/store/service/test closeout，并冻结 panel same-site `/api/operator/*` proxy namespace，为后续 domain rollout 提供稳定 BFF seam。
- [x] **Phase 4: Panel Shared Data Layer** — 已完成 `protected-panel-web` observability 共用 route shell、typed data provider、shared filter/query substrate 与 queue cursor helper，为 `Phase 5-9` 固定 panel-side consumption contract。
- [x] **Phase 5: Panel Overview Domain** — 已完成 `Overview` 页 cutover；总览卡片、核心趋势图、alert 摘要、基础筛选与 runtime diagnostics 降级区块均已落地。
- [x] **Phase 6: Panel Quality Domain** — 已完成 `Quality` 页 cutover；runtime quality summary、趋势图、sampled grading summary、badcase queue 与基础 drill-down 均已落地。
- [x] **Phase 7: Panel Safety/Authz Domain** — 已完成 `Safety/Authz` 页；decision summary、fail-close posture、ACL anomaly queue 与基础 drill-down 均已落地。
- [x] **Phase 8: Panel Cost Domain** — 已完成 `Cost` 页；token/cost summary、timeseries、按 `model` / `surface` 的成本分布与基础收口均已落地。
- [x] **Phase 9: Panel Audit Domain** — 已完成 `Audit` 页 cutover；audit timeline、detail drawer 与 trace/issue/request backlink 已落地。
- [x] **Phase 10: Sink Participation And Grade Backflow** — 已完成 `Sentry` tag/context 收口、`Axiom` allowlist + canonical envelope、以及 `quality.sampled_grade` backflow productization，不新增 panel truth owner。
- [x] **Phase 11: Dev Smoke And Evidence** — 已完成 dev seeded smoke、截图、console/network artifact 与回归清单。
- [ ] **Phase 12: Staging Smoke And Planning Closeout** — 完成 staging 验收、剩余 gap 清零与 workstream closeout。
