---
doc_type: plan
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Phase 1 Plan

## Objective

在实现任何 multi-step executor 之前，先把 `bounded agentic retrieval` 的 typed plan contract、step taxonomy、budget/fail-close 语义与 planner/executor ownership 冻结成 repo truth。

## Tasks

1. 新增 phase-level contract/design docs
   - 冻结 `RetrievalPlan / RetrievalStep / StepResult` 的最小字段组
   - 明确 owner placement：
     - `packages/contracts`
     - 或 `rag-agent <-> retrieval-core` internal seam
   - 明确哪些字段禁止泄漏为 browser-facing contract

2. 冻结 allowed step taxonomy
   - 明确首批 admitted step types
   - 明确 structured runtime query、general web fallback、unadmitted remote capability 为显式非目标
   - 明确 `historical / as_of / compare / freshness_sensitive / live_assisted` 与 step taxonomy 的关系

3. 冻结 budget 与 fail-close semantics
   - plan budget
   - per-step budget
   - live lookup budget
   - bounded replan 规则
   - budget exhausted / unresolved gate 的 terminal semantics

4. 冻结 planner/executor boundary
   - `rag-agent` 负责什么
   - `retrieval-core` 负责什么
   - 哪些 filter 在 planner 时决定
   - 哪些 filter 在 executor 时继续 enforcement

5. 冻结 plan 与 existing truth 的接缝
   - `version_query` 如何进入 retrieval plan
   - runtime-profile / authz / visibility / source-trust gate 如何进入 plan precondition
   - candidate set / supporting evidence / query activity 的分层

6. 形成 phase-level primary recommendation
   - `RetrievalPlan` 首轮 placement 默认保持在 `rag-agent <-> retrieval-core` boundary
   - initial step taxonomy 默认保持 closed enum
   - `StepResult` 默认拆成 grounding/reference/activity/failure 四层
   - `live_source_lookup` 默认只允许 repo-owned admitted live source adapter

7. 更新 planning registry truth
   - 把 workstream entry、roadmap、state 与 repo registry 对齐到 `Phase 1` active 状态
   - 明确 `Phase 2` 只有在 typed plan contract 冻结后才开始

## Constraints

- 不改写当前 merged truth 为“已经完成 multi-step agentic retrieval”
- 不把 structured runtime tools 拉回 generic retrieval planner
- 不把 `RetrievalRequest` 直接冒充成 `RetrievalStep`
- 不为 future flexibility 引入过度泛化或开放域 capability
- 不在没有 plan truth 的情况下先写 hidden-prompt multi-step patch

## Verification

- `docs/plans/archive/completed/bounded-agentic-retrieval-productization.md`
- `.planning/workstreams/bounded-agentic-retrieval-productization/REQUIREMENTS.md`
- `.planning/workstreams/bounded-agentic-retrieval-productization/ROADMAP.md`
- `.planning/workstreams/bounded-agentic-retrieval-productization/STATE.md`
- `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-1-typed-retrieval-plan-contract/CONTEXT.md`
- `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-1-typed-retrieval-plan-contract/RESEARCH.md`
- `.planning/workstreams/bounded-agentic-retrieval-productization/phases/phase-1-typed-retrieval-plan-contract/PLAN.md`
- `git diff --check` 通过

## Exit Criteria

- repo 中存在正式的 `Phase 1` planning artifacts
- workstream 已从 `deferred` 切到 `active`
- `Phase 1` 的 contract freeze 范围、non-goals 与验证口径已明确
- phase-level research 已对官方资料与 repo 边界给出 primary recommendation
- 下一步可以直接在 `Phase 1` 基础上做 contract/doc freeze，而不必重新争论这条线是否独立存在
