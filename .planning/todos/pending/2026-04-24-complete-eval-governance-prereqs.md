---
created: 2026-04-24T09:34:00+08:00
title: 补齐 QA harness 前置 eval governance
area: testing
owner: eval
priority: backlog-after-app-api
files:
  - docs/reference/qa-assistant-and-harness-gap-review.md
  - docs/reference/eval-gold-truth-model.md
  - docs/reference/eval-benchmark-artifact-contract.md
  - .planning/workstreams/eval/STATE.md
  - .planning/workstreams/eval/phases/phase-5-golden-dataset-and-case-governance/PLAN.md
  - packages/evals/
---

## Problem

产品级 QA harness 不应先于 eval governance 落地。当前 `eval` 已完成
shared runtime、artifact contract、publish/backflow seam 与 release-gate
automation，但 `Phase 5` 仍等待采集内容补全后启动。

这意味着 coverage matrix、denominator truth、retrieval qrels shared
governance、workflow/status case governance、deterministic answer truth 与
synthetic candidate intake 还不是完整 shared governance。

当前不进入 app-api-first scope；保留为 eval backlog，等 app-api 前置缺口
收口后恢复。

## Solution

后续恢复时优先完成 eval `Phase 5`，把它作为 QA harness design 的前置条件：

1. 冻结 admitted corpus / collection / case family coverage matrix。
2. 明确 `smoke / regression_locked / release_gate / exploratory` denominator。
3. 收口 retrieval qrels、workflow/status、deterministic answer truth 的共享治理。
4. 定义 synthetic candidate intake 如何进入 review、golden set 或 rejected set。
5. 完成后再允许冻结 QA harness contract。
