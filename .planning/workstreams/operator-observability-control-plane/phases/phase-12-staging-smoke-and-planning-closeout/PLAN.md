---
doc_type: phase_plan
phase: "12"
phase_name: "Staging Smoke And Planning Closeout"
status: completed
created: 2026-04-21
updated: 2026-04-21
---

# Phase 12 Plan

## Objective

以真实 staging/browser/sink evidence 关闭 `operator-observability-control-plane` 的最终验收缺口，并把 workstream 正式收口为 completed。

## Execution Steps

1. 验证 staging 三端 health、真实 chat request、panel 左侧导航与 `/api/operator/*` live route。
2. 以 `Sentry` span 和 `Axiom` `projection.drain` 行为证据收口 sink participation，不再停留在 token-scope blocker。
3. 补齐 `Phase 12` phase artifacts，并把 `.planning/WORKSTREAMS.md`、workstream `ROADMAP.md` / `STATE.md`、archive plan 统一更新到 completed truth。
4. 修正 smoke artifact 中残留的 `Axiom blocked` / `pending closeout` 表述。

## Exit Rule

`Phase 12` completes only when:

- staging chat 与 panel 路径都已通过真实浏览器验收
- `projection.drain` 已在 `Axiom` 中被直接证明，而不是仅靠 `Sentry` 推断
- workstream `ROADMAP.md` / `STATE.md` / `.planning/WORKSTREAMS.md` 一致表达 `12/12` 已完成
- operator observability plan 已进入 archive completed namespace，并带明确 reopen rule
