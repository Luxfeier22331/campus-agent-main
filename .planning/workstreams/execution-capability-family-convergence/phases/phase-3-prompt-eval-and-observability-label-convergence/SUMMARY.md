---
phase: "3"
name: "Prompt Eval And Observability Label Convergence"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 3 Summary

## What Closed

- prompt-facing wording 已从 legacy runtime label 收口到 `rag-agent` / `knowledge-path` 语义，不再把 `rag-specialist` 当默认 model-facing persona。
- eval 语义已正式拆层：
  - `TraceExpectation.expected_runtime_target` 继续断言 raw runtime target
  - `TraceExpectation.expected_capability_family` 单独承载 family / report label truth
  - trace grader 通过显式 mapping 从 runtime target 派生 family label，不再把两种语义混进单一 `expected_handoff`
- observability / operator wording 已写实：
  - `selected_target` / `selectedTarget` 继续只表示 raw runtime target
  - capability family / display wording 必须走显式 projection / mapping
  - 不通过 schema rename 或 raw field overload 做 family migration
- `Phase 3` 没有重开 `Phase 2` 的 contract semantics，也没有提前进入 package dir / import path / runtime object rename。

## Fresh Evidence

- `packages/rag-specialist/src/campus_rag_specialist/prompts/rag_clarify_v1.md`
- `packages/rag-specialist/src/campus_rag_specialist/prompts/rag_no_answer_v1.md`
- `packages/rag-specialist/src/campus_rag_specialist/prompts/rag_unsupported_v1.md`
- `docs/architecture/prompt-and-instruction-architecture.md`
- `packages/evals/src/campus_evals/models.py`
- `packages/evals/src/campus_evals/expectations.py`
- `packages/evals/src/campus_evals/scenarios.py`
- `packages/evals/README.md`
- `tests/evals/test_golden_cases.py`
- `docs/architecture/operator-observability-architecture.md`
- `docs/contracts/app-api-operator-observability-http.md`

## Verification

- `uv run --all-packages python -m unittest tests.evals.test_golden_cases.GoldenCaseSchemaTest tests.evals.test_golden_cases.RunCasesTest`
  - passed
  - 验证 `TraceExpectation` 的 runtime target / capability family split 与 trace grader 行为
- `uv run --all-packages python -m unittest tests.supervisor.test_supervisor_core tests.specialist.test_rag_specialist tests.evals.test_golden_cases`
  - passed
  - `225` tests passed
- `git diff --check -- docs/architecture/prompt-and-instruction-architecture.md docs/architecture/operator-observability-architecture.md docs/contracts/app-api-operator-observability-http.md`
  - passed

## External Grounding

- Anthropic `Building effective agents`
  - routing / specialized follow-up tasks 需要清晰分工与接口，不应把 runtime label、family label、prompt persona 混成一个概念
- OpenTelemetry semantic conventions / entity identity model
  - 监控字段应保持稳定、最小且不混义；raw identity 与 display / descriptive label 应显式分层

## Handoff

- `Phase 3` 已正式 completed。
- 下一步进入 `Phase 4: Package And Runtime Rename Decision`。
- `Phase 4` 只讨论 package dir / import path / runtime object label 是否真的迁移，以及迁移边界如何一次性收口；不回头重做 prompt / eval / observability wording split。
