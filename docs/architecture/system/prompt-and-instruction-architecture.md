---
doc_type: architecture
truth_scope: execution
owner_boundary: prompt-runtime
status: active
created: 2026-04-05
updated: 2026-06-13
---

# Prompt And Instruction Architecture

<!-- markdownlint-disable MD013 -->

## Document Boundary

This file is the stable prompt/instruction architecture index. It owns the
document boundary and reading order only. Prompt runtime baseline, assembly
rules and rollout/observability details live in split supporting docs.

## Split Documents

- `prompt-and-instruction/current-runtime-baseline.md`
  - Current runtime baseline: accepted baseline, stance, ownership and posture
- `prompt-and-instruction/assembly-and-assets.md`
  - Assembly and assets: instruction hierarchy, system prompt blueprint, prompt families and asset placement
- `prompt-and-instruction/safety-observability-and-rollout.md`
  - Safety, observability and rollout: zones, packets, eval and rollout posture

## Index-Owned Baseline

## 文档边界

本文冻结 `campus-agent` 的 prompt / instruction supporting architecture。

它回答的是：

- Execution Agent Layer-led execution path 应该如何分层设计 system / developer / task instructions
- 哪些内容必须继续由代码拥有，哪些内容适合交给 prompt
- prompt assets 在 repo 中由谁拥有、如何版本化、如何进入 eval / release gate
- retrieval evidence、personalization、observability 与 prompt 之间的边界如何固定

它不负责：

- 某个 vendor SDK 的具体调用方式
- 某个模型版本的最终选型
- 某次迭代的具体 prompt 文案
- retrieval / serving / capability-opening truth 的产品级决策
