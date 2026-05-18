---
doc_type: phase_umbrella
phase: "5"
phase_name: "Golden Dataset And Case Governance"
status: completed
created: 2026-04-24
updated: 2026-05-10
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
  - completed for current-corpus query-enabled surfaces
  - 正式扩编 accepted case、retrieval qrels、workflow/status case、deterministic answer truth 与
    synthetic candidate promotion，并以 known-gap/no-hit contract 固定缺源行为
  - 认证态 canonical regulation 缺口已移交 backlog seed，不再作为 eval blocker

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

## Residual Backlog

- 当前 eval workstream 无 active blocker。
- 缺失认证态 canonical regulation 的补采与后续 accepted truth 晋升登记在
  `.planning/seeds/SEED-005-authenticated-canonical-regulation-gap-collection.md`。
- 该 backlog 不能用相近文档、notice 引用或 synthetic answer 替代 canonical source；在补采前，
  相关 query 继续由 known-gap/no-hit contract 约束。

## Exit Rule

`Phase 5A` 和当前 corpus 范围内的 `Phase 5B` 均已完成，`eval` 已正式拥有 shared golden
dataset governance。后续 source 补采是新 backlog/source-domain work，不改变本 workstream
completed 状态，除非 shared eval governance 或 current-corpus contract 本身漂移。
