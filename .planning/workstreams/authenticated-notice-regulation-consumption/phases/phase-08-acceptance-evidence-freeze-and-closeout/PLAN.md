---
doc_type: phase_plan
phase: "8"
phase_name: "Acceptance Evidence Freeze And Closeout"
status: completed
created: 2026-04-21
updated: 2026-04-24
---

# Phase 8 Plan

## Objective

冻结当前 bounded `notice -> regulation target` lane 的 acceptance evidence，
补齐 runbook/reference/planning continuity，并在 `offline_preparation` stop point 不变的前提下，
把这条 workstream 正式收口为 `Completed`。

## Why This Phase Exists

当前 repo 在 `Phase 7` 之后应拥有：

- 最终 rerun evidence
- final `validation-summary.json`
- final `document-reports.jsonl`

但如果没有最后一步，repo 仍然缺少：

- canonical evidence 存档口径
- docs continuity
- workstream completed-state truth

## Locked Inputs

- 当前 canonical evidence 只包括：
  - `chunk-prep-manifest.json`
  - `validation-summary.json`
  - `document-reports.jsonl`
- stop point 固定为 `offline_preparation`
- 只收口当前 `11` 条 admitted target

## Tasks

1. 冻结 final evidence set
   - 固定 institutional/scoped 最终 artifact 保存位置
   - 确认 artifact 引用路径、target count、pass/fail 结论稳定

2. 补齐 docs continuity
   - runbook 指向最终 operator path
   - reference 指向最终 acceptance truth 与 inventory boundary
   - plan doc 指向 closeout 后的恢复入口

3. 更新 planning registry
   - workstream `STATE.md` 写入 final verification 与 reopen guidance
   - `ROADMAP.md` 标记 `Phase 8` 完成
   - `.planning/WORKSTREAMS.md` 将该条 workstream 移入 `Completed`

4. 做 final verification
   - 确认 artifact triplet 完整
   - 确认当前 scope 仍是 `11` 条 admitted target
   - 确认没有把 stop point 提升到 release/opening

## Proposed Write Set

- `docs/runbooks/internal-notice-regulation-target-quality-acceptance-runbook.md`
- `docs/reference/institutional-regulations-promotion-quality-acceptance.md`
- `docs/reference/institutional-regulations-offline-inventory.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/REQUIREMENTS.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/STATE.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/ROADMAP.md`
- `.planning/WORKSTREAMS.md`

## Constraints

- 不新增新的 evidence schema
- 不把 acceptance artifact 当成 external serving contract
- 不在 closeout 阶段重开 `Phase 6-7` 的失败分类逻辑

## Verification Matrix

- evidence verification
  - institutional/scoped 两条 lane 都有最终：
    - `chunk-prep-manifest.json`
    - `validation-summary.json`
    - `document-reports.jsonl`
- continuity verification
  - runbook / reference / plan doc 互相可追溯
  - `STATE.md` / `ROADMAP.md` / `WORKSTREAMS.md` 状态一致
- scope verification
  - completed truth 仍明确 stop 在 `offline_preparation`
  - reopen rule 只在新增 target、边界改写或 stop point 提升时触发

## Exit Rule

Phase 8 完成后，repo 应达到：

- bounded `11` 条 target lane 的 acceptance evidence 已冻结
- 文档与 planning registry 连续可恢复
- `authenticated-notice-regulation-consumption` 作为 bounded workstream 已正式完成
