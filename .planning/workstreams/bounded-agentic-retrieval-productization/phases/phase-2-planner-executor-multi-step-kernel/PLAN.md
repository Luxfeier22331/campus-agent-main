---
doc_type: plan
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Phase 2 Plan

## Objective

把 `Phase 1` 冻结的 retrieval plan seam 接成最小但真实的 multi-step kernel：
`rag-agent` 发出 ordered plan，`retrieval-core` 执行 ordered steps，并在不扩写产品边界的前提下支持 compare 与 bounded replan。

## Tasks

1. 新增 internal seam models
   - 在 `packages/retrieval-core` 新增 code-level typed models：
     - `RetrievalPlan`
     - `RetrievalStep`
     - `StepResult`
     - `RetrievalExecutionResult`
   - 实现 closed vocabulary validation、budget normalization 与 basic invariants

2. 新增 executor kernel
   - 在 `packages/retrieval-core` 新增：
     - `execute_retrieval_plan(...)`
   - 支持 ordered step execution
   - 支持 dependency-free step grouping 的实现接口，即使首轮先串行执行
   - 让 executor 负责：
     - request mapping
     - authz / visibility / version / runtime-profile enforcement
     - step result collection
     - merged candidate set shaping

3. 保留并收口 single-step compatibility path
   - 让 `retrieve_sources(...)` 保持为 single-step convenience wrapper
   - 明确 wrapper 与 new kernel 的 owner 关系
   - 避免 repo-wide 调用点一次性断裂

4. 新增 `rag-agent` ordered planner
   - 让当前 query planning 结果映射成真正的 `RetrievalPlan`
   - `current / historical / as_of`
     - 输出单步 `indexed_lookup`
   - `compare`
     - 输出双步 `indexed_lookup`
   - planner 继续不 admission：
     - `freshness_gate`
     - `live_source_lookup`
     - structured runtime tools

5. 落成 bounded replan
   - 首轮只允许 1 次 bounded replan
   - 只允许：
     - query rewrite
     - selector narrowing
   - 不允许：
     - scope widening
     - trust policy loosening
     - 切换到 live branch

6. 将 executor result 收回当前 answer path
   - 从 `RetrievalExecutionResult` 提取 merged evidence / supporting evidence input
   - 保持当前 browser / supervisor-facing result contract 不变
   - 不把 raw plan / raw activity 泄漏到 `SpecialistResponse`

7. 补测试
   - retrieval-core:
     - seam model validation
     - plan execution mapping
     - compare 双步 execution
     - bounded replan / budget exhausted fail-close
   - rag-agent:
     - plan emission
     - current/historical/as_of/compare branch mapping
     - compare 单侧证据不足时继续 fail-close

## Constraints

- 不把 `Phase 2` 扩成 `Phase 3`
- 不引入 general web fallback
- 不把 structured runtime tools 混进 retrieval planner
- 不改写 public / supervisor-facing contracts
- 不把 `retrieve_sources(...)` 的兼容保留写成长期双轨腐烂逻辑；新 kernel 必须成为唯一多步 owner

## Verification

- planning artifacts:
  - `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-2-planner-executor-multi-step-kernel/CONTEXT.md`
  - `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-2-planner-executor-multi-step-kernel/RESEARCH.md`
  - `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-2-planner-executor-multi-step-kernel/PLAN.md`
- targeted code verification when implementation starts:
  - `uv run --all-packages python -m unittest tests.retrieval.test_service tests.retrieval.test_backend_qdrant`
  - `uv run --all-packages python -m unittest tests.specialist.test_rag_specialist`
  - if new tests are added, run only the directly affected retrieval / rag-agent suites
- hygiene:
  - `git diff --check` 通过

## Exit Criteria

- repo 中存在 code-level `RetrievalPlan / RetrievalStep / StepResult`
- `rag-agent` 能发出 ordered plan，而不再只输出 rewrite label
- `retrieval-core` 能执行多步 indexed lookup kernel
- compare query 不再只是“版本 filter 的偶然拼接”，而是正式的 dual-step execution
- bounded replan 以 code-owned budget / fail-close 规则运行
