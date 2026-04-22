---
doc_type: phase_plan
phase: "2"
phase_name: "Benchmark Runtime And Artifact Lifecycle"
status: completed
created: 2026-04-24
updated: 2026-04-24
---

# Phase 2 Plan

## Objective

把 handbook-branded benchmark runtime 收口成 shared neutral core，并把 accepted artifact lifecycle 固定成 repo-owned contract。

## Execution Slices

### Slice 1: Neutralize Shared Benchmark Core

- 用 `formal_benchmark` 取代 handbook-named shared core
- handbook / curriculum / official-web profile 只保留 profile assembly

### Slice 2: Freeze Shared Artifact Contract

- 冻结 `run / repair / accept / publish` 目录布局与稳定字段
- 明确 `request_correlation` 是 publish/backflow 的 canonical first-party truth

### Slice 3: Freeze Acceptance Runtime Semantics

- 固定 repair target selection
- 固定 final-summary / accept-config shape
- 固定 runtime observability artifact 位置

## Exit Rule

完成后，shared runtime 与 artifact lifecycle 不再依赖 handbook 语义，也不再靠会话解释维持。

