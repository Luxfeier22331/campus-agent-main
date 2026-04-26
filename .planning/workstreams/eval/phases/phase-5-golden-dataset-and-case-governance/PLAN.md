---
doc_type: phase_plan
phase: "5"
phase_name: "Golden Dataset And Case Governance"
status: active
created: 2026-04-24
updated: 2026-04-27
---

# Phase 5 Plan

## Objective

在采集内容补全后，把 `golden dataset`、coverage matrix、retrieval qrels、workflow/status case、workflow trace case、deterministic answer truth 与 synthetic candidate intake 正式并入 shared eval governance。

## Locked Inputs

- `Phase 1-4` 已完成，不回滚 runtime / artifact / publish / automation owner boundary
- domain truth owner 继续属于 handbook / curriculum / notice / official-web 等对应 workstream
- 不允许用单次 acceptance 结果直接改 repo baseline

## Execution Slices

### Slice 1: Freeze Coverage Matrix / Denominator Truth

- admitted corpus / collection / case family inventory
- `smoke / regression_locked / release_gate / exploratory` split boundary

### Slice 2: Freeze Shared Case Governance

- retrieval qrels
- workflow/status cases
- workflow trace cases
  - direct-vs-delegate branch correctness
  - handoff correctness
  - tool argument precision
  - guardrail / fail-close correctness
  - trace projection completeness
- deterministic answer truth
- synthetic candidate intake

### Slice 3: Freeze Drift Handling

- serving surface 变化时的 owner 顺序
- fixture drift detection
- regression inventory update discipline

## Blocker

- 等待采集内容补全

## Exit Rule

完成后，`eval` 才算正式拥有 shared golden dataset governance；在此之前，这个 phase 保持 pending。
