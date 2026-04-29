---
doc_type: phase_plan
phase: "13"
phase_name: "Eval Operations Governance"
status: completed
created: 2026-04-29
updated: 2026-04-29
---

# Phase 13 Plan: Eval Operations Governance

## Objective

把 eval runtime 的 provider preflight、预算、retry、flake/quarantine、artifact
retention、scheduled gate 与 case-set version drift 收口成长期 operations governance。

## Entry Conditions

- Phase 1-5 的 shared runtime/artifact/case governance 已完成。
- 至少一个 product-path 或 tool-family eval profile 已进入常设运行。
- provider-backed supplemental adapter 与 deterministic gate 都已有稳定 artifact。

## Scope

- 固定 eval profile budget、timeout、retry、pacing 与 breaker policy。
- 定义 flaky case quarantine 与 re-admission rule。
- 定义 artifact retention、naming、promotion 与 cleanup rule。
- 定义 scheduled/manual gate 的适用范围和 failure disposition。
- 维护 case-set version / policy artifact / prompt/model/index drift report。

## Non-Goals

- 不把 supplemental provider availability 变成 canonical deterministic truth。
- 不把 all eval lanes 升级成 PR hard gate。
- 不通过 quarantine 掩盖 runtime regression。

## Exit Criteria

- eval operations runbook 与 machine-readable profile policy 存在。
- failed / skipped / quarantined / repaired case 都有可审计 disposition。
- case-set and runtime version drift 可在 release evidence 中被定位。
