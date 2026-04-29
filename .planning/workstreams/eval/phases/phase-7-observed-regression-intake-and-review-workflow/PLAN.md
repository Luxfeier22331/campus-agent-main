---
doc_type: phase_plan
phase: "7"
phase_name: "Observed Regression Intake And Review Workflow"
status: completed
created: 2026-04-29
updated: 2026-04-29
---

# Phase 7 Plan: Observed Regression Intake And Review Workflow

## Objective

把 production badcase、negative feedback、operator review 与 incident backfill 收口为
eval-owned observed regression intake workflow。

## Entry Conditions

- Phase 5A candidate lifecycle / review decision contract completed.
- app-api operator candidate export seam 可用。
- eval-side pending review manifest shape 已冻结。

## Scope

- 支持 operator badcase candidate、negative feedback candidate 与 incident
  candidate 的 intake。
- 建立 review / dedupe / admission CLI 或 repo-owned workflow。
- 记录 `accept`、`reject`、`duplicate`、`deprecated`、`needs_info` 决策。
- 只把通过 review 的样本迁入 repo-owned observed regression fixture。

## Non-Goals

- 不让 panel 或 app-api 直接决定 golden truth。
- 不把 raw transcript、raw auth material、raw provider payload 或 raw retrieval dump
  持久化进 eval fixture。
- 不把 pending-review case 设为 blocking release gate。

## Exit Criteria

- observed regression candidate 可以从 operator seam 进入 pending review manifest。
- accepted candidate 必须重写为 eval-owned case model。
- review decision 有 source request / trace correlation / reviewer / reason / target
  suite。
