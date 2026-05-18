---
doc_type: context
status: active
created: 2026-05-04
updated: 2026-05-04
---

# Phase 2 Context

## Why This Phase Exists

Phase 1 只解决“谁负责什么”。Phase 2 要把主链路真正改成 planner-first runtime，而不是
继续以 single-shot answer composition 伪装成 agentic retrieval。

## Repo Facts

- `service.py` 仍在串联 scope resolution、pre-retrieval response、retrieval stage、supporting
  evidence、grounding 与 final answer composition。
- `agent.py` 仍包含 candidate selection 与 answer synthesis 组合逻辑。
- 当前 retrieval baseline 已有 typed plan / multi-step 的长期设计边界，但 rag-agent 还没有把
 主链路彻底改成显式 plan -> retrieve -> evidence -> synthesize。
  本 phase 只消费 Phase 1 冻结的 internal seam，不重新决定 seam placement。

## Output Of This Phase

- 主链路显式 planner-first
- 旧的 implicit decision path 收口
- retrieval failure / no-answer / low-confidence 语义更细
- planner output 与 executor input 的 hidden state 回流被禁止
