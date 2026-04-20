---
doc_type: phase_plan
phase: "3"
phase_name: "Prompt Eval And Observability Label Convergence"
status: planned
created: 2026-04-21
updated: 2026-04-21
---

# Phase 3 Plan

## Objective

把 prompt docs/assets、eval/report surfaces、observability/operator wording 中仍然混用的 capability labels 收口成一套清晰规则，同时保持 `Phase 2` 已冻结的 current runtime target contract 不变。

## Why This Phase Exists

`Phase 2` 已经把 contract semantics 收口干净，但 repo 仍然存在三类腐烂风险：

- prompt-facing assets 继续把 legacy runtime target label 暴露成 role/persona truth
- eval 继续把 raw runtime target assertion 与 report/display label 混成一个概念
- observability docs / operator wording 继续围绕 raw `selected_target` 描述，而没有显式 derived label rule

如果不做这一步，后续很容易出现：

- prompt 文案、grader 断言、panel/operator summary 各自发明不同的 family 名字
- prompt 改动无法通过稳定的 eval/report vocabulary 衡量
- observability 想要做 family grouping 时再次重载 `selected_target`

## Locked Inputs

- `Phase 1` 已冻结：
  - `supervisor` 保持 invariant role name
  - `rag-specialist -> rag-agent`
  - `navigation-specialist -> navigation-agent`
  - `campus-services-agent` / `notice-agent` 是 canonical forward/current runtime labels
- `Phase 2` 已冻结：
  - `selected_target` / `selectedTarget` 继续只表示 current runtime target
  - current serialized contract 不承载 forward family label
  - operator display label 必须来自显式 mapping / presentation layer
- availability 删除/退休正在并发线推进；本 phase 只消费已合流的 merged truth，不以它为主线输入。

## Decisions To Freeze

1. prompt-facing wording、eval/report wording、observability/operator wording 都必须明确区分：
   - raw runtime target
   - forward family label
   - operator-facing display label
2. raw runtime target 继续保留在：
   - `selected_target` / `selectedTarget`
   - current runtime storage / telemetry correlation field
   - deterministic handoff assertions
3. prompt-facing assets 不再把 `rag-specialist` / `navigation-specialist` 当默认 human/model-facing capability label。
4. eval/report surfaces 如果需要 family label，必须新增显式字段、helper 或 projection，不重载 deterministic runtime assertion field。
5. observability/operator surfaces 如果需要 family grouping 或 display wording，必须由 app-owned mapping / projection 派生，不改 raw storage/filter field。
6. package dir、import path、runtime object label rename 继续 deferred 到 `Phase 4`。

## Execution Slices

### Slice 1: Audit Wording Surfaces By Meaning

- 把相关 surface 切成三类：
  - prompt-facing persona / role / family wording
  - eval deterministic assertion vs report/display wording
  - observability raw dimension vs operator-facing label/grouping wording
- 至少覆盖：
  - `docs/architecture/prompt-and-instruction-architecture.md`
  - `packages/rag-specialist/src/campus_rag_specialist/prompts/`
  - `packages/evals/src/campus_evals/{models,scenarios,expectations}.py`
  - `packages/evals/README.md`
  - `docs/architecture/operator-observability-architecture.md`
  - `apps/app-api` / `protected-panel-web` 中已有或缺失的 mapping / projection seam

### Slice 2: Freeze Prompt-Facing Vocabulary

- 为 prompt docs/assets 固定一条规则：
  - 可以使用 forward family label，或更中性的 capability wording
  - 不再把 legacy runtime target label 当默认 role persona
- 至少收口：
  - architecture prompt docs
  - rag prompt markdown assets
  - prompt registry / metadata 中对 owner / family / eval suite 的 wording 边界

### Slice 3: Split Eval Assertion Truth From Report Truth

- deterministic eval 继续允许断言 raw runtime target
- 但 report/readme/scenario schema 必须显式区分：
  - runtime dispatch assertion
  - family/report label
- 目标是避免 `expected_handoff` 继续承担两种语义
- 如果需要新增字段，优先考虑：
  - `expected_runtime_target`
  - `expected_capability_family`
  - `observed_capability_family`
  命名以执行时 codebase analog 为准

### Slice 4: Freeze Observability Label Projection Rule

- `selected_target` 继续作为 raw filter / storage / sink correlation truth
- operator-facing family grouping / label 不得重载这个字段
- 至少要在 docs / app-owned helper 中写实：
  - 何处继续保留 raw target
  - 何处展示 derived label
  - 何处允许 future family grouping
- 如果实现中需要 helper，优先做 app-owned mapping/projection helper，而不是 schema rename

### Slice 5: Verification And Phase Boundary Freeze

- 确保 prompt/eval/observability wording convergence 不误伤：
  - current contract tests
  - package/runtime rename scope
  - raw telemetry/storage field truth
- 明确 `Phase 4` 只接 package/runtime rename decision，不重复处理 wording split

## Proposed Write Set

- `.planning/workstreams/execution-capability-family-convergence/phases/phase-3-prompt-eval-and-observability-label-convergence/CONTEXT.md`
- `.planning/workstreams/execution-capability-family-convergence/phases/phase-3-prompt-eval-and-observability-label-convergence/RESEARCH.md`
- `.planning/workstreams/execution-capability-family-convergence/phases/phase-3-prompt-eval-and-observability-label-convergence/PLAN.md`
- `.planning/workstreams/execution-capability-family-convergence/STATE.md`
- `docs/plans/execution-capability-family-convergence.md`
- `docs/architecture/prompt-and-instruction-architecture.md`
- `docs/architecture/operator-observability-architecture.md`
- `packages/rag-specialist/src/campus_rag_specialist/prompts/rag_clarify_v1.md`
- `packages/rag-specialist/src/campus_rag_specialist/prompts/rag_no_answer_v1.md`
- `packages/rag-specialist/src/campus_rag_specialist/prompts/rag_unsupported_v1.md`
- `packages/rag-specialist/src/campus_rag_specialist/prompts/registry.py`
- `packages/evals/src/campus_evals/models.py`
- `packages/evals/src/campus_evals/scenarios.py`
- `packages/evals/src/campus_evals/expectations.py`
- `packages/evals/README.md`
- 如执行中确有必要，再补：
  - `apps/app-api/src/modules/projection/`
  - `apps/app-api/src/modules/operator-query/`
  - `apps/protected-panel-web/src/panel/requests/request-formatters.ts`

## Verification Matrix

- planning truth
  - `Phase 3` 目录存在 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
  - `STATE.md` 的 `Current Plan` 指向 `Phase 3`
- prompt truth
  - prompt-facing docs/assets 不再把 legacy runtime target 作为默认 persona/family wording
  - prompt registry metadata 与 prompt family wording 不再互相混义
- eval truth
  - deterministic runtime target assertion 仍可独立存在
  - report/display/family wording 与 runtime assertion 已显式分离
- observability truth
  - raw `selected_target` 继续保留为 current runtime target dimension
  - operator-facing display/grouping wording 通过显式 mapping / projection 派生
- boundary truth
  - 不触发 package dir/import path/runtime object rename
  - 不重载 `selected_target`

## Verification Commands

- `git diff --check -- .planning/workstreams/execution-capability-family-convergence docs/plans/execution-capability-family-convergence.md docs/architecture/prompt-and-instruction-architecture.md docs/architecture/operator-observability-architecture.md packages/rag-specialist/src/campus_rag_specialist/prompts/rag_clarify_v1.md packages/rag-specialist/src/campus_rag_specialist/prompts/rag_no_answer_v1.md packages/rag-specialist/src/campus_rag_specialist/prompts/rag_unsupported_v1.md packages/rag-specialist/src/campus_rag_specialist/prompts/registry.py packages/evals/src/campus_evals/models.py packages/evals/src/campus_evals/scenarios.py packages/evals/src/campus_evals/expectations.py packages/evals/README.md`
- `uv run --all-packages python -m unittest tests.evals.test_golden_cases`
- `uv run --all-packages python -m unittest tests.supervisor.test_supervisor_core tests.specialist.test_rag_specialist tests.evals.test_golden_cases`
- 如涉及 panel/operator mapping helper，再补：
  - `pnpm --dir apps/protected-panel-web test`

## Exit Rule

`Phase 3` 完成后，repo 应达到：

- prompt-facing assets、eval/report surfaces、observability/operator wording 对 capability family 的语义不再混层
- raw runtime target 继续只留在需要断言/过滤/存储的 surface
- future family label / display label 的使用规则已经被显式写成 repo truth
- `Phase 4` 可以只讨论 package/runtime rename decision，而不必回头清理 prompt/eval/observability wording
