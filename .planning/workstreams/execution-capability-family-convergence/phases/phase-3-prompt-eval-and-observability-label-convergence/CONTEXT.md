---
phase: "3"
name: "Prompt Eval And Observability Label Convergence"
created: 2026-04-21
updated: 2026-04-21
status: planned
---

# Phase 3 Context

**Gathered:** 2026-04-21
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责：

- 收口 prompt / eval / observability surfaces 上的 capability family wording
- 明确哪些 surface 继续保留 raw current runtime target，哪些 surface 应改用 forward family label 或 neutral capability wording
- 把 operator / report / grader 需要的 label split 写成显式规则，而不是继续混用 `selected_target`
- 为 `Phase 4` 的 package dir / import path / runtime object rename decision 提供干净前置条件

它不负责：

- 改 `SpecialistTarget` / `selected_target` / `selectedTarget` 的 current runtime contract 语义
- package dir rename、import path rename、runtime object rename
- 改 `app-api` runtime schema、数据库列名、sink 原始字段名
- 重开 `Phase 2` 的 current-truth contract label migration
- 把 availability 删除线并回这条 workstream

</domain>

<current_truth>
## Current Truth

- `Phase 2` 已冻结：
  - `selected_target` / `selectedTarget` 继续只表示 current runtime target
  - current serialized contract 不承载 forward family label
  - panel 已通过显式 mapping 展示 operator-friendly target label
- prompt / instruction surfaces 仍存在 mixed wording：
  - `docs/architecture/system/prompt-and-instruction-architecture.md` 同时使用 package path、`rag-specialist` role wording 和 forward architecture 讨论
  - `packages/rag-specialist/src/campus_rag_specialist/prompts/*.md` 直接写 `rag-specialist clarification/no-answer/unsupported composer`
- eval surfaces 仍存在 raw handoff wording 与 report wording 混层：
  - `packages/evals/src/campus_evals/models.py` 里 `TraceExpectation.expected_handoff` 仍把 raw runtime target 当唯一 handoff label
  - `packages/evals/src/campus_evals/scenarios.py`、`expectations.py`、若干 benchmark/runtime helper 仍把 `rag-specialist` 写成 report-visible truth
  - `packages/evals/README.md`、artifact summary 里继续直接外露 `selected_target`
- observability / operator wording 仍以 raw target 为中心：
  - `docs/architecture/system/operator-observability-architecture.md` 把 `selected_target` 作为 monitoring 维度与 request-scoped summary truth
  - `apps/app-api` telemetry / projection / operator query surfaces 继续以 `selected_target` 为 canonical raw field
  - `protected-panel-web` 已完成 display mapping，但 schema / filter field 继续使用 `selectedTarget`
- 当前 repo 已明确：
  - `rag-specialist` / `navigation-specialist` 仍是 current runtime target / package truth
  - `campus-services-agent` / `notice-agent` 已是 current runtime target
  - `availability-specialist` 的退休由并发线处理，不属于本 phase 的固定输入

</current_truth>

<decisions>
## Planning Decisions

- **03-01:** `Phase 3` 只收口 wording / labeling surfaces；raw runtime contract field 不变。
- **03-02:** prompt-facing role wording 不再把 legacy runtime target label 当默认 human/model-facing family truth；应改成：
  - forward family label，或
  - 更中性的 capability wording
  具体选型在执行前由 phase plan 固定，但不得反向改动 runtime target enum。
- **03-03:** eval 需要同时保留两种 truth：
  - deterministic/runtime assertion truth
  - operator/report/family label truth
  二者不能再混在 `expected_handoff` 这类单一字段里。
- **03-04:** observability / operator surface 继续保留 `selected_target` 作为 raw filter / storage / sink correlation field；
  如果需要 family grouping 或 display wording，必须使用显式 projection / mapping，不重载 raw field。
- **03-05:** 如果某处 wording 直接面向用户、operator、grader 或 reviewer，它默认不应继续裸露 `rag-specialist` 这类 legacy runtime label，除非该 surface 的职责就是断言 current runtime contract。
- **03-06:** package path、import path、pyproject package name 是否迁移，继续严格 deferred 到 `Phase 4`。

</decisions>

<specifics>
## Concrete Gaps

- prompt docs 里已经冻结了“package-owned prompt family”架构，但 role wording 仍把 `rag-specialist` 当默认 prompt persona 名称。
- eval model / scenario / report 当前没有把“raw runtime target assertion”和“family/report label”拆成两个显式概念。
- operator observability architecture 已有 `selected_target` raw truth，但还没有把“operator-facing capability label / family grouping”写成统一 projection rule。
- `apps/app-api` / `packages/evals` / docs 当前仍可能把 raw runtime target 当作跨 surface 的唯一 label，容易在下一轮实现中又把 contract truth、display truth、family truth 混回去。

</specifics>

<canonical_refs>
## Canonical References

- `.planning/workstreams/execution-capability-family-convergence/REQUIREMENTS.md`
- `.planning/workstreams/execution-capability-family-convergence/ROADMAP.md`
- `.planning/workstreams/execution-capability-family-convergence/STATE.md`
- `.planning/workstreams/execution-capability-family-convergence/phases/phase-2-current-truth-contract-label-migration/SUMMARY.md`
- `docs/plans/execution-capability-family-convergence.md`
- `docs/architecture/system/prompt-and-instruction-architecture.md`
- `docs/architecture/system/operator-observability-architecture.md`
- `docs/contracts/app-api-operator-observability-http.md`
- `docs/data/app-api-schema.md`
- `packages/rag-specialist/src/campus_rag_specialist/prompts/`
- `packages/rag-specialist/src/campus_rag_specialist/prompts/registry.py`
- `packages/supervisor-core/src/campus_supervisor_core/prompts/registry.py`
- `packages/evals/src/campus_evals/models.py`
- `packages/evals/src/campus_evals/scenarios.py`
- `packages/evals/src/campus_evals/expectations.py`
- `packages/evals/README.md`
- `apps/app-api/src/modules/telemetry/`
- `apps/app-api/src/modules/operator-query/`
- `apps/app-api/src/modules/projection/`

</canonical_refs>

<deferred>
## Deferred Follow-up

- `Phase 4`: package dir / import path / runtime object rename decision
- `selected_target` / `selectedTarget` 的 contract enum 变更
- 任何数据库列 rename、Axiom/Sentry 原始字段 rename、schema migration
- availability 删除线的并线与清理

</deferred>
