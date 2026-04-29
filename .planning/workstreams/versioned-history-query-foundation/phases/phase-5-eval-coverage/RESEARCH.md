---
doc_type: phase_research
phase: "5"
phase_name: "Eval Coverage"
status: completed
created: 2026-04-21
updated: 2026-04-21
---

# Phase 5 Research

## External Sanity Check

这轮只核对与 `Phase 5` 直接相关的官方资料，重点确认 eval case 设计应该如何贴合 version-aware RAG。

### OpenAI

- Evals Guide
  - `https://platform.openai.com/docs/guides/evals`
  - 官方方向是先把 task-specific、可重复、自动判定的 eval case 固定下来，再用这些 case 驱动系统回归。
  - 对当前 phase 的含义是：
    - `versioned history` 不需要新建一套评测框架
    - 应直接扩现有 `GoldenCase` / deterministic metrics
    - eval 输入必须保留 typed request truth，不能把版本模式还原成 prompt 文本约定

### Microsoft

- RAG Evaluators
  - `https://learn.microsoft.com/en-us/azure/ai-foundry/concepts/evaluation-evaluators/rag-evaluators`
  - 官方把 RAG eval 拆成：
    - retrieval/process evaluation
    - groundedness/relevance/completeness system evaluation
  - 对当前 phase 的含义是：
    - `version_filter_unresolved` 与 `compare_support_incomplete` 应被视为 process/fail-close regression
    - `historical / as_of / compare` 的 completed answer 需要显式 semantic outcome truth，而不是只看 answer 文本像不像

## Internal Interpretation

结合 repo 当前 shape，Phase 5 的最小正确实现不是“多写几条 case”，而是同时补齐三件事：

1. eval case 需要携带 typed `version_query`
2. deterministic metric 需要锁住 version-aware completed semantics
3. 当前不能承载 non-current request 的 app-api eval path 必须 fail-fast，避免假阳性

## Planning Implication

Phase 5 的推荐执行顺序是：

1. 扩 `GoldenCase` request truth
2. 扩 deterministic metric
3. 新增 versioned history regression inventory
4. 让 legacy eval executor 透传 `version_query`
5. 为 app-api eval client 补显式 fail-fast guard
6. 用 targeted unittest 锁定上述边界
