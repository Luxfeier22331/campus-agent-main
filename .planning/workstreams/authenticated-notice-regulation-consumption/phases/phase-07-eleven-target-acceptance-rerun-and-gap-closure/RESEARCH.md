---
phase: "7"
artifact: "research"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 7 Research

## Purpose

把 `Phase 7: Eleven-Target Acceptance Rerun And Gap Closure` 建立在当前已冻结的 bounded
target inventory、target-side acceptance runbook 与 fail-close metrics 之上，避免 rerun
重新退回 promotion/materialization 边界讨论。

## Repo Pattern Readings

- `.planning/workstreams/authenticated-notice-regulation-consumption/REQUIREMENTS.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/ROADMAP.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/STATE.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-06-institutional-regulations-target-chunk-prep-parity/CONTEXT.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/phases/phase-07-eleven-target-acceptance-rerun-and-gap-closure/CONTEXT.md`
- `docs/reference/institutional-regulations-offline-inventory.md`
- `docs/reference/institutional-regulations-promotion-quality-acceptance.md`
- `docs/runbooks/internal-notice-regulation-target-quality-acceptance-runbook.md`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_institutional_regulation_chunk_prep.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_scoped_rule_chunk_prep.py`
- `tests/ingestion/test_internal_notice_institutional_regulation_chunk_prep.py`
- `tests/ingestion/test_internal_notice_scoped_rule_chunk_prep.py`

## Findings

### 1. 当前 rerun scope 已经被 offline inventory 冻结为 `11` 条 admitted target

- `institutional_regulations`
  - 只保留 institution-wide stable regulation target
- `scoped_rules`
  - 只保留 annual/time-bound holding target
- duplicate hold、auth-blocked、out-of-scope follow-up 都已被 inventory 明确排除。
- 因此 `Phase 7` 不需要再做 admission 讨论；只需要对这 `11` 条 target 做 local-only acceptance rerun。

### 2. fail-close 指标已经明确，不需要在 rerun 时临场发明新 gate

- runbook 已固定 institutional lane 关注：
  - title
  - contextualization
  - identity metadata
  - semantic-owner lineage
  - wrapper leak
  - front matter leak
- scoped-rules lane 已固定关注：
  - title
  - contextualization
  - projection metadata
  - `cycle_year`
  - `school_unit_name`
  - wrapper leak
  - front matter leak
- 所以 rerun 的职责是：
  - 触发这些 gate
  - 汇总 `validation-summary.json`
  - 根据 `document-reports.jsonl` 做 gap closure

### 3. 当前代码已经把 rerun 所需 machine-readable artifact 固定下来了

- 两条 lane 都会导出：
  - `chunk-prep-manifest.json`
  - `validation-summary.json`
  - `document-reports.jsonl`
- 因此 `Phase 7` 不需要额外的人工 checklist 才能判断通过/失败；artifact 已足够支撑批量 rerun 与差异对比。

### 4. rerun 的 gap 应该按 target-side failure class 分类，而不是回流到 source-side generic cleanup

- 当前 workstream 的授权只覆盖：
  - target metadata
  - chunk-prep input
  - semantic-owner lineage
- 所以 gap closure 应按以下 target-side类别收口：
  - title/contextualization
  - identity/projection metadata
  - semantic-owner lineage
  - wrapper/front matter leakage
- 不应把 `Phase 7` 扩成 source-wide replay 或 broader OCR cleanup。

### 5. `351119` 与 auth-dependent owner recovery 继续不属于 rerun白名单

- offline inventory 已明确把 `351119` 留在 auth-blocked frontier。
- 因此 `Phase 7` 的 full rerun 不能把它算进 “11 targets”。
- 这保证当前 rerun 是对已 materialized target 的 hardening，而不是对 blocked frontier 的补录。

### 6. `Phase 7` 的正确输出是 zero-fail closeout 或明确 residual gap list

- 如果 rerun 全通过，`Phase 8` 可以直接做 evidence freeze。
- 如果 rerun 有失败，应该得到：
  - per-document failure class
  - bounded fix list
  - rerun closure evidence
- 不能停在“跑过一次但没总结”的中间状态。

## Phase-7 Decisions To Freeze

1. rerun scope 固定是当前 `11` 条 admitted target，不扩大、不回混 blocked/out-of-scope items。
2. rerun 只消费 target-side acceptance artifacts，不重开 promotion/materialization boundary。
3. gap closure 只围绕 target-side fail-close class 展开，不扩成 source-wide replay。
4. `351119` 继续留在 auth workstream，不进入当前 phase。
5. `Phase 7` 的通过标准是：
   - either full zero-fail rerun
   - or bounded residual gap list + fix/rerun closure

## Deferrals

- `Phase 8`
  - evidence freeze
  - closeout registry update
- future reopen
  - auth-dependent owner recovery
  - wider source scope or new admitted target
  - serving/release opening

## Risks If Mis-Scoped

- 如果 rerun 白名单重新扩大，`Phase 7` 会从 bounded closeout 退化成新一轮 inventory/admission 讨论。
- 如果 gap 不按 target-side failure class 分类，fix 工作会反向污染 source-side boundary。
- 如果不输出 machine-readable rerun summary，`Phase 8` 就没有可靠 evidence 可冻结。

## Conclusions For Phase 7

1. `Phase 7` 的核心是对当前 `11` 条 target 做一次完整且可复盘的 local-only acceptance rerun。
2. 当前 artifact contract 已经足够承接 rerun 与 gap closure。
3. 只要 `Phase 6` 的 parity seam 稳住，`Phase 7` 就不需要再讨论 operator path，只需要处理真实 fail-close 问题。
