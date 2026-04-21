---
doc_type: plan
status: superseded
created: 2026-04-22
updated: 2026-04-22
---

# Eval

## 文档边界

本文固定 `campus-agent` 的 shared eval / acceptance workstream 基线。

它负责：

- `packages/evals` 的 shared owner 边界
- deterministic gate、supplemental adapter 与 artifact contract 的分层
- golden dataset / case governance 与 live benchmark profile 的治理边界
- eval runtime、repair、accept 与 publish 的长期顺序
- release-gate / CI automation 的前向收口顺序

它不负责：

- handbook / curriculum / notice / navigation 等 domain truth 本体
- retrieval、runtime tool、panel 或 supervisor 的业务实现
- 把 operator observability read model 重新收回 eval 侧
- 把单次 benchmark rerun 叙事写成 repo 默认真相

## Lifecycle Contract

- 文档 lifecycle 保持 `active`
- 当前 active/deferred/backlog state 以 `.planning/WORKSTREAMS.md` 为准
- 单条 execution truth 固定在 `.planning/workstreams/eval/`

## Goal

把 repo 里已经存在但尚未长期收口的 shared eval substrate 正式提升为持久化 workstream：
让 `packages/evals`、golden dataset governance、artifact contract、operator publish seam 与 release gate automation 不再分散寄生在各条 feature workstream 的收口阶段。

## Current Baseline

当前 repo 已具备：

- 原生 `eval` workstream 入口与 shared owner shell
- `docs/reference/golden-dataset-case-matrix.md` 作为 coverage matrix / denominator truth 入口
- retrieval qrels、workflow/status golden case 与 deterministic runner
- handbook / curriculum / official-web live benchmark profile
- supplemental adapter、preflight、repair 与 acceptance artifact contract
- `app-api` internal eval ingress 与 request correlation seam
- operator observability publish/backflow capability

但当前仍待收口：

- Phase 1 的 owner / contract / non-goals freeze
- Phase 2 的 golden dataset and case governance 显式顺序
- benchmark / artifact / publish / CI gate 的长期推进顺序

## Fixed Phase Order

这条 workstream 固定按以下顺序推进：

1. shared ownership and contract freeze
2. golden dataset and case governance
3. benchmark runtime and artifact lifecycle
4. publish / backflow seam
5. CI / release gate automation

固定原因：

- 先冻结 owner 与 contract，后续 domain eval 才不会继续各写各的 shared rule
- golden dataset / case 治理必须先于 runtime automation，否则只会把漂移数据自动化
- coverage matrix / denominator truth 必须先于 qrels / workflow / answer truth 扩样，否则 case family 会失去稳定分母
- publish/backflow 必须建立在 artifact contract 已稳住之后
- CI/release gate 只能自动化已经明确的 eval truth，不能反向定义 truth

其中 Phase 2 固定按以下子顺序收口：

1. coverage matrix and denominator truth
2. retrieval qrels hardening
3. workflow/status set hardening
4. deterministic answer truth expansion
5. synthetic candidate intake governance

## Exclusions

固定不包含：

- 某个单一 domain 的具体 case authoring 细节
- retrieval feature、runtime tool 或 source-channel opening
- panel 页面设计或 operator domain 扩面
- provider / sink vendor 绑定

## References

Phase 2 的扩样顺序细节继续由 `golden-dataset-execution-plan.md` 作为 supporting reference 保留，但 owner 固定在本 workstream。

- `packages/evals/README.md`
- `docs/plans/archive/superseded/golden-dataset-execution-plan.md`
- `docs/architecture/operator-observability-architecture.md`

## Handoff Rule

后续接手时：

1. 先看 `.planning/WORKSTREAMS.md`
2. 再看 `.planning/workstreams/eval/STATE.md`
3. 需要回溯 shared eval contract 时，再看本文与 `packages/evals/README.md`
4. 需要回溯 Phase 2 expansion order 时，再看 `docs/plans/archive/superseded/golden-dataset-execution-plan.md`
