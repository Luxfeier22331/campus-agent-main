---
doc_type: phase_plan
status: backlog
created: 2026-04-29
updated: 2026-04-29
---

# Phase 3 Plan: Quality Read Model And Metrics

## Goal

把 feedback 汇总进 operator-facing quality metrics，使线上质量和 drift 具备用户信号输入。

## Tasks

1. 确认 feedback aggregate 是直接 query、projection，还是进入现有 operator metric rollup。
2. 增加 summary 指标：
   - feedback coverage
   - helpful count / rate
   - unhelpful count / rate
   - no-answer + unhelpful overlap
3. 增加 dimensions：
   - surface
   - answer kind
   - intent / capability summary
   - citation/source posture
   - reason code
4. 在 operator quality query service 中增加 typed response fields。
5. 更新 protected-panel-web 如当前 quality UI 需要展示这些字段。
6. 增加 operator query tests 与 denominator tests。

## Exit Criteria

- operator quality API 可查询 feedback aggregates。
- denominator 明确，空数据与低样本窗口展示稳定。
- metrics 不依赖 raw sink query 或 panel-side synthesis。

## Verification

- app-api operator quality targeted tests
- protected-panel-web data provider tests if UI contract changes
