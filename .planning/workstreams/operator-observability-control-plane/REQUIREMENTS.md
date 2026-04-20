---
doc_type: requirements
status: active
created: 2026-04-19
updated: 2026-04-20
---

# Requirements: Operator Observability Control Plane

## Goal

在已落 `apps/app-api` owned operator truth 的基线上，把 operator observability/control-plane 从“后端 seam 已存在、panel 仍停在壳层/请求域”推进到可 smoke 的完整 rollout：收口 residual aggregate API、完成 panel same-site BFF 与 `Overview / Quality / Safety/Authz / Cost / Audit` 域扩面，并把 sink participation / grading backflow 固定回 app-owned truth。

## In Scope

- `apps/app-api` operator aggregate contract 的 residual gap closeout
- `apps/app-api` operator observability route / store / integration verification
- `protected-panel-web` same-site `/api/*` operator-observability BFF seam
- `protected-panel-web` 的 `Overview / Quality / Safety/Authz / Cost / Audit` 域扩面
- `Requests` detail 中现有 observability / audit summary 与新域的集成收口
- `Sentry` / `Axiom` / grading 的 backlink / sink participation / app-owned 回流 closeout
- dev / staging smoke artifact 与 planning closeout

## Non-goals

- 重开 `shared-product-surfaces-acceptance-hardening` 的三端验收 scope
- panel 直读 raw sink 或 raw audit log
- panel 变成 trace explorer、SQL console 或 raw telemetry viewer
- 打开 `Jobs` / `Operations`
- 新增 operator 写操作、ack / resolve / retry / export API
- 为单个 dashboard 做独立视觉大重构或 triage table 全量翻修

## Success Criteria

1. `app-api` 持续是 operator-facing observability read-model owner，panel 不绕回 `apps/supervisor-api`、数据库或 sink。
2. operator aggregate contract 与代码实现对齐，`Overview / Quality / Safety/Authz / Cost / Audit` 的 runtime-owned read surface 不再停在半开状态。
3. `protected-panel-web` 通过 same-site BFF 稳定消费 observability domains，不复用当前壳层 `/api/overview` 作为 aggregate truth。
4. panel `Overview / Quality / Safety/Authz / Cost / Audit` 能以 app-owned projection / rollup 呈现，不退化成占位页或 blocked menu item。
5. `Sentry` / `Axiom` / grading 继续只作为 backlink、sink 或回流输入，不直接替代 canonical query truth。
6. 至少存在 fresh dev smoke；如进入 staging，则 staging artifact 与 planning truth 同步回写，不把 dev/browser evidence 冒充成 staging closeout。

## Canonical Entry

- `docs/plans/operator-observability-control-plane-foundation.md`
