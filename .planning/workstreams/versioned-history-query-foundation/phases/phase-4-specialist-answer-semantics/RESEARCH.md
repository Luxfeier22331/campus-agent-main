---
doc_type: phase_research
phase: "4"
phase_name: "Specialist Answer Semantics"
status: completed
created: 2026-04-21
updated: 2026-04-21
---

# Phase 4 Research

## External Sanity Check

这轮只做与 `Phase 4` 直接相关的官方资料核对，重点确认 grounded answer、citation-backed synthesis、以及 RAG answer evaluation 的约束。

### OpenAI

- Agent Builder Safety
  - `https://developers.openai.com/api/docs/guides/agent-builder-safety`
  - 强调 agent workflow 要用 layered guardrails，而不是只依赖单个 prompt。
  - 对当前 phase 的含义是：
    - historical/as_of/compare 不能只靠 prompt 提醒模型“说清楚”
    - answer semantics 必须有 runtime-owned structure 与 fail-close 分支

- Citation Formatting
  - `https://developers.openai.com/api/docs/guides/citation-formatting`
  - 强调在 grounded answering 中需要显式规定 citation format、来源引用位置，以及多来源引用约定。
  - 对当前 phase 的含义是：
    - compare 回答应先明确 primary/comparison evidence 分区，再决定如何展示支持集
    - 如果没有稳定 support，不能照常输出变化点结论

### Microsoft

- RAG Evaluators
  - `https://learn.microsoft.com/en-us/azure/ai-foundry/concepts/evaluation-evaluators/rag-evaluators`
  - 把 groundedness 定义成“不脱离给定 context 的 precision”，把 completeness 定义成“不遗漏关键事实的 recall”。
  - 对当前 phase 的含义是：
    - historical/as_of 先保证 groundedness，不允许把“现行版本”内容混入历史回答
    - compare 回答除了 groundedness，还需要后续 phase 的 completeness eval 去核对变化点是否漏答

- Agent Framework RAG
  - `https://learn.microsoft.com/en-us/agent-framework/agents/rag`
  - 明确建议 agent 在使用提供的 context 回答时“在可用时引用 source document”。
  - 对当前 phase 的含义是：
    - version-aware 回答应继续保持 source-backed semantics
    - compare 模式需要能说明“旧版依据来自哪里 / 新版依据来自哪里”

## Internal Interpretation

结合 repo 当前 shape，这些官方资料对 `Phase 4` 导出的最小结论是：

1. 不能把 version-aware answer semantics 做成纯 prompt 文案。
2. 需要一个 code-owned 的 version-aware answer framing layer，先把：
   - query mode
   - primary/comparison selection
   - temporal anchor
   - evidence partition
   固定下来，再交给 answer synthesis。
3. current / historical / as_of / compare 至少要对应不同的 `semantic_outcome` 或 diagnostics truth，避免 Phase 5 无法回归。
4. compare 模式必须先有双侧 evidence，再讨论变化点总结；否则应 fail-close。

## Planning Implication

`Phase 4` 的推荐实现顺序应为：

1. version-aware runtime context
2. version-aware diagnostics contract
3. deterministic answer framing for historical/as_of/compare
4. prompt/citation integration only after the above are stable
