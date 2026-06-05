---
doc_type: requirements
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Requirements: Rag-Agent Agentic Retrieval Rearchitecture

## Goal

将 `packages/rag-agent` 重整为 planner-first retrieval specialist：显式规划、显式检索、
显式证据选择、显式 grounding、显式 answer synthesis，并把旧的 answer-shape /
title-lookup 之类启发式从“决策权”降级为最多只影响展示。

`RetrievalPlan / RetrievalStep / StepResult` 在本 workstream 的首轮落点固定为
`packages/rag-agent <-> packages/retrieval-core` 的 internal seam；本线不把它们先提到
`packages/contracts`，也不让 `retrieval-core` 反向吸收 supervisor / app-api 语义。

## In Scope

- `packages/rag-agent` 内部角色拆分：
  - planner
  - retrieval executor / orchestration
  - evidence selector
  - answer synthesizer
  - grounding validator
- `service.py` / `service_*` / `agent.py` 中的单轮式组合逻辑重构。
- `title_lookup`、condition/detail/fact shape 等旧式 answer-shape 决策的收口或移除。
- upstream bounded context consumption 的 typed input/output 约束。
- retrieval plan / retrieval stage / evidence bundle / grounding summary 的可观测化。
- answer relevancy / faithfulness 低分的 stage-level 归因能力。
- rag-agent 侧性能诊断：重复 prompt、冗余 shaping、过宽 candidate selection、诊断
  运行时开销与 eval 输入膨胀。

## Non-goals

- 不改变 `app-api`、browser surface、supervisor routing 或 ingestion/data-plane owner。
- 不新增 query-enabled surface。
- 不把 `rag-agent` 重新变成顶层 capability router 或开放域 fallback。
- 不把 `packages/contracts` 填进具体 runtime / provider / infra 类型。
- 不把共享 eval substrate 的 owner 从 `eval` workstream 夺过来。

## Success Criteria

1. `rag-agent` 的代码与文档都能清楚区分 planner、retrieval、evidence selection、
   synthesis 与 grounding 的职责。
2. `title_lookup` 之类 heuristics 不再决定 answer success；如果保留，只能是过渡性
   display hint，不能作为 answer success 兼容路径。
3. retrieval plan、step activity、evidence selection 与 grounding verdict 能进入
   sanitized observability / eval artifact。
4. 低 relevancy / low faithfulness 的 failure 可以归因到 plan、retrieval、evidence、
   synthesis 或 grounding 中的具体阶段，而不是只看到 opaque prompt output。
5. multi-step retrieval 仍然 bounded、fail-close，并且不扩大 query-enabled scope。
6. rag-agent 相关 slow path 可以区分为真实检索开销、prompt 组合开销、诊断开销或
   eval/adapter 开销，而不是混成一个不可解释的“RAG 很慢”结论。
7. 与现有 bounded retrieval baseline 对接时，不破坏已开放的 current serving surface。
8. `RetrievalPlan / RetrievalStep / StepResult` 的首轮 placement 与 owner 能被明确说清，
   并与 `bounded-agentic-retrieval-productization` 的 baseline seam 对齐。
9. Phase 5 closeout 具有明确可判定的 reopen rule：如果 `title_lookup` 或其他旧式 shape
   heuristic 再次影响 answer success、或者 stage-level observability / fail-close 真相退化，
   workstream 必须 reopen。

## Canonical Entry

- `.planning/workstreams/agentic-rag-runtime-rearchitecture/README.md`

## Related Architecture

- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/decisions/adr-0007-phase1-retrieval-baseline-update.md`
- `docs/decisions/adr-0042-capability-neutral-supervisor-routing-and-surface-capability-policy.md`
