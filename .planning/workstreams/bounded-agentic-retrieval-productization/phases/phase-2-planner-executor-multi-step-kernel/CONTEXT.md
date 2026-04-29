---
doc_type: context
status: active
created: 2026-04-21
updated: 2026-04-21
---

# Phase 2 Context

## Why This Phase Exists

`Phase 1` 已把 retrieval plan seam 冻结成正式 repo truth，但 repo 当前仍没有 code-level
`RetrievalPlan / RetrievalStep / StepResult`，也没有真正的 multi-step executor。

如果这一步继续停在文档层，后续会出现三个直接问题：

- `rag-agent` 仍只能输出 rewrite-level label，无法把 compare / bounded replan / future
  freshness branch 接成真实执行路径
- `retrieval-core` 仍只有单次 `RetrievalRequest` kernel，无法表达 ordered step execution 与
  step result layering
- `Phase 3/4` 的 freshness、live branch、query activity observability 会失去 code-owned 挂点

因此 `Phase 2` 的目标不是再扩 architecting，而是把 `Phase 1` 的 frozen seam 接成最小可执行
kernel。

## Repo Facts

- `packages/rag-agent/src/campus_rag_agent/service.py` 当前仍是直接 planning 后调用一次
  `retrieve_sources(...)`
- `packages/retrieval-core/src/campus_retrieval_core/models.py` 当前只有单次 `RetrievalRequest`
  dataclass
- `packages/retrieval-core/src/campus_retrieval_core/service.py` 当前只有：
  - `build_retrieval_backend(...)`
  - `retrieve_sources(...)`
- versioned-history query foundation 已完成：
  - typed `version_query`
  - registry-backed version resolution
  - retrieval version filter
  - historical / as_of / compare answer semantics
- 当前已有测试已经证明：
  - historical version resolution 会在 retrieval 前 fail-close
  - compare 语义需要双侧证据，不允许单侧降级回答
- 当前 public / supervisor-facing contract 仍只消费 `EvidenceBundle`、supporting evidence 与
  grounded answer；`Phase 2` 不应直接扩写 browser-facing schema

## Phase Boundary

本 phase 只处理：

- internal seam 的 code-level typed models
- `rag-agent` ordered plan emission
- `retrieval-core` multi-step execution kernel
- bounded replan
- 与现有 `EvidenceBundle` 路径的兼容收口

本 phase 不处理：

- `freshness_gate / live_source_lookup` 的正式 runtime branch
- general web fallback
- structured runtime tool family admission
- operator observability 面板化

## Primary Implementation Constraint

这一步必须优先选择“能真实接回当前代码”的最小 kernel，而不是一次把所有 admitted step
types 都堆进 executor。

当前最现实的首轮 execution subset 应是：

- `indexed_lookup`

其中：

- `current` / `historical` / `as_of` 可以先映射成单步 `indexed_lookup`
- `compare` 可以映射成双步 `indexed_lookup`
- `entity_resolution` 继续先保留为 planner-side helper
- `scope_follow_up` 保持 reserved
- `freshness_gate` 与 `live_source_lookup` 继续留给 `Phase 3`

## Phase Output

本 phase 必须产出并验证：

- code-level `RetrievalPlan / RetrievalStep / StepResult`
- `retrieval-core` 的 `execute_retrieval_plan(...)`
- `retrieve_sources(...)` 与 new kernel 的兼容关系
- `rag-agent` 的 ordered multi-step plan emission
- compare query 的双步 execution 与 bounded replan/fail-close truth
