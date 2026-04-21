---
doc_type: plan
status: completed
created: 2026-04-21
updated: 2026-04-21
---

# Operator Observability Control-Plane Foundation

## Completion Note

这条 `operator observability / control-plane` workstream 已关闭。
它完成的是 `apps/app-api` owned operator aggregate read model、`protected-panel-web` 的 `Overview / Quality / Safety / Cost / Audit` 域扩面、
`Sentry / Axiom / sampled grading` sink participation 收口，以及最终的 staging/browser/sink acceptance 与 planning closeout。

## What This Plan Closed

- 固定 `apps/app-api` 继续作为 operator-facing observability read-model owner
- 收口 `GET /api/operator/*` aggregate family 与 panel same-site BFF seam
- 完成 `Overview / Quality / Safety / Cost / Audit` 五个 observability domain page 的实际 rollout
- 固定 `Sentry` / `Axiom` / grading 只作为 backlink、sink 或回流输入，不直接成为 panel canonical truth
- 以真实 staging/browser/sink evidence 关闭 `projection.drain`、trace correlation 与 planning drift

## Current Canonical Entry

- `docs/architecture/operator-observability-architecture.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/domains/operator-observability.md`
- `.planning/WORKSTREAMS.md`
- `.planning/workstreams/operator-observability-control-plane/STATE.md`

## Reopen Rule

只有在 repo 重新 admission 新的 operator observability domain、
显式改写 `app-api` owned operator truth / sink participation contract，
或 panel 需要从当前 read-only observability control-plane 扩成新的 write/action surface 时，
才应恢复这条 workstream。
