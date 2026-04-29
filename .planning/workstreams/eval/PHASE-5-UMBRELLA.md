---
doc_type: phase_umbrella
phase: "5"
phase_name: "Golden Dataset And Case Governance"
status: split
created: 2026-04-24
updated: 2026-04-29
---

# Phase 5 Umbrella: Golden Dataset And Case Governance

## Objective

把 `golden dataset`、coverage matrix、retrieval qrels、workflow/status case、workflow trace case、
deterministic answer truth 与 synthetic candidate intake 正式并入 shared eval governance。

2026-04-29 review 后，Phase 5 不再作为单个被数据量整体阻塞的 phase 执行，而是拆成：

- `Phase 5A: Case Governance Scaffold`
  - completed
  - 不等待完整 corpus coverage
  - 冻结 case lifecycle、denominator registry scaffold、workflow trace artifact model、
    candidate intake manifest、review decision 与 drift/admission discipline
- `Phase 5B: Golden Dataset Expansion And Domain Case Governance`
  - 等采集 / 消费内容补全后推进
  - 正式扩编 accepted case、retrieval qrels、workflow/status case、deterministic answer truth 与
    synthetic candidate promotion

## Locked Inputs

- `Phase 1-4` 已完成，不回滚 runtime / artifact / publish / automation owner boundary。
- domain truth owner 继续属于 handbook / curriculum / notice / official-web 等对应 workstream。
- 不允许用单次 acceptance 结果直接改 repo baseline。
- OpenAI Evals、Agents SDK trace、RAGAS、Sentry、Axiom 或其他外部系统只能作为 debug sink、
  supplemental grader 或 candidate mining input，不能替代 repo-owned case truth。

## Routing

- completed scaffold plan: `./phases/phase-5a-case-governance-scaffold/PLAN.md`
- deferred data-dependent plan:
  `./phases/phase-5b-golden-dataset-expansion-and-domain-case-governance/PLAN.md`

## Blocker

- 采集内容不足只阻塞 `Phase 5B` 的正式 accepted case 扩编。
- 采集内容不足不阻塞 `Phase 5A` 的 governance scaffold。

## Exit Rule

`Phase 5A` 和 `Phase 5B` 都完成后，`eval` 才算正式拥有 shared golden dataset governance。
在此之前，Phase 5 umbrella 保持 split 状态。
