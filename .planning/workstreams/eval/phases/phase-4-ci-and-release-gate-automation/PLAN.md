---
doc_type: phase_plan
phase: "4"
phase_name: "CI And Release Gate Automation"
status: completed
created: 2026-04-24
updated: 2026-04-24
---

# Phase 4 Plan

## Objective

把 shared eval lane 变成 repo-owned manual release gate automation，而不是继续依赖本地会话。

## Execution Slices

### Slice 1: Add Shared Eval Gate CLI

- `doctor`
- `accept`
- `publish`

### Slice 2: Add Manual Workflow

- `workflow_dispatch`
- env doctor
- acceptance
- optional publish dry-run
- artifact upload

### Slice 3: Add Runbook And Verification

- admitted profiles 与参数说明
- publish dry-run 默认策略
- targeted unit tests

## Exit Rule

完成后，repo 已具备 manual shared eval release gate，不把它提升成 PR hard gate。

