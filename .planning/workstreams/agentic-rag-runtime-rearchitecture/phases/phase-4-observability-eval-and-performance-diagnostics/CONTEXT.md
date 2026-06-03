---
doc_type: context
status: active
created: 2026-05-04
updated: 2026-05-04
---

# Phase 4 Context

## Why This Phase Exists

当前最难的是判断低分来自哪里，以及 ragas / diagnostic 运行到底慢在哪里。Phase 4
要把 stage-level observability 和 eval / perf diagnostics 收口。
这一步需要具体到字段和 artifact，而不是仅仅“增加更多日志”。

## Repo Facts

- 当前 eval substrate 已经存在，但本线只消费，不接管。
- ragas diagnostic 目前可用于分析，但不能替代 stage-level runtime truth。
- 用户最关心的 failure 归因是：
  - 检索不够
  - 证据不够
  - 编排有问题
  - 诊断本身太慢
  因此观察契约至少要能表达 `request_id`、`plan_id`、`query_mode`、`stage_name`、
  `stage_status`、`candidate_count`、`supporting_evidence_count`、`grounding_verdict`、
  `failure_reason`、`latency_ms`、`retrieval_ms`、`prompt_ms`、`adapter_ms` 与
  `diagnostic_ms`。

## Output Of This Phase

- stage-level trace summary
- failure attribution
- relevancy / faithfulness regression fixture
- performance diagnostic decomposition
- 明确的 observation schema / perf breakdown contract
