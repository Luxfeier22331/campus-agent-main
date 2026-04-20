---
doc_type: plan
status: deferred
created: 2026-03-29
updated: 2026-04-20
---

# Golden Dataset Execution Plan

## 文档边界

本文固定 golden dataset 后续扩样与治理的前向实施 contract。

它负责：

- retrieval qrels、workflow/status case、deterministic answer truth 的扩样顺序
- canonical case 与 synthetic candidate 的治理边界
- coverage matrix 与 baseline interpretation 的更新规则

它不负责：

- 改写 `ADR-0003` / `ADR-0004` 的长期治理语义
- 重写 live execution state 或单次 acceptance 叙事
- 把 supplemental judge / ragas 升级成 canonical merge gate

## Lifecycle Contract

- 文档 lifecycle 保持 `deferred`
- 本文只保留 expansion order、acceptance contract 与长期排除项
- 任何 active 扩样波次都只写在 `.planning/WORKSTREAMS.md` 与对应 workstream `STATE.md`

## Current Baseline

当前 merged truth 已固定的前提：

- golden dataset 治理与指标分层已在 `ADR-0003` / `ADR-0004` 冻结
- `packages/evals` 已具备 retrieval qrels、workflow/status golden case 与 deterministic runner
- `docs/reference/golden-dataset-case-matrix.md` 已承担 coverage matrix 入口
- handbook / curriculum 已存在稳定的 repo-tracked baseline，但后续高风险 lane 仍可继续扩样

## Fixed Expansion Order

golden dataset 后续始终按以下顺序推进：

1. coverage matrix and denominator truth
2. retrieval qrels hardening
3. workflow/status set hardening
4. deterministic answer truth expansion
5. synthetic candidate intake governance

固定原因：

- 先固定分母，后续 case 扩样才不会把 coverage 叙事写成漂移状态
- retrieval truth、workflow truth 与 answer truth 必须分层推进，不回退成“单题单答案文本”
- synthetic candidate 只能在 canonical case 体系已稳住后再接入

## Forward Phases

### Phase A: Coverage Matrix

目标：

- 持续维护 corpus-by-corpus 的 coverage matrix

退出条件：

- `covered / partial / missing` 只记录 repo 可证明事实
- denominator 与 case family 变化会同步回写 matrix

### Phase B: Retrieval Qrels Hardening

目标：

- 继续按高风险 lane 扩充 handbook / curriculum retrieval qrels

退出条件：

- case 以 `rationale`、forbidden source 与 stable denominator 为中心维护
- 高风险 case 才晋升 `regression_locked`

### Phase C: Workflow / Status Set Hardening

目标：

- 把稳定 workflow case 继续沉淀到 `smoke` / `regression_locked` / `release_gate`

退出条件：

- `completed`、`needs_clarification`、`no_answer`、`error` 继续独立建模
- `error` 终态仍走 deterministic fault injection

### Phase D: Deterministic Answer Truth

目标：

- 扩充 `required_facts`、`forbidden_claims`、citation completeness 与 trace truth

退出条件：

- answer truth 只对适用 case 计分
- deterministic gate 继续保持 primary

### Phase E: Synthetic Candidate Governance

目标：

- 将 synthetic candidate 固定为受控 intake lane

退出条件：

- candidate 与 canonical case 物理分离
- synthetic 默认先进 `exploratory`
- 只有通过审核后才允许晋升到稳定 case family

## Exclusions

固定不包含：

- threshold / merge gate 重新定义
- supplemental provider 运行面问题的长期叙事
- 单次 `.tmp` rerun artifact 作为默认 baseline 入口

## Handoff Rule

后续接手时：

1. 先看 `docs/reference/golden-dataset-case-matrix.md`
2. 再看 `.planning/WORKSTREAMS.md` 与对应 workstream `STATE.md`
3. 再回到本文确认扩样顺序与 synthetic/canonical 边界
