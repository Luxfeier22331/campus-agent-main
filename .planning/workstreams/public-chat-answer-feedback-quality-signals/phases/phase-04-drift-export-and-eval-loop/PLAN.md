---
doc_type: phase_plan
status: backlog
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 4 Plan: Drift Export And Eval Loop

## Goal

把 negative feedback 转成可复核的 badcase / eval candidate 输入，支持 intent drift 与 false positive / false negative 分析。

## Tasks

1. 定义 negative feedback candidate export shape。
2. 加入 request/message correlation metadata：
   - request id
   - conversation id
   - assistant message id
   - answer kind
   - intent / capability summary
   - citation/source posture
   - feedback reason codes
3. 增加 manual review labels：
   - false positive
   - false negative
   - wrong intent
   - stale/missing evidence
   - answer style issue
4. 接入 packages/evals 或现有 eval artifact 生成入口。
5. 增加 privacy / retention guard：不导出 raw auth material、provider raw response 或超范围 transcript。

## Exit Criteria

- negative feedback 能生成 reviewable candidate set。
- candidate set 能成为后续合成/真实 case set 的输入。
- export 不反向成为 panel canonical truth。

## Verification

- eval/export targeted tests
- fixture review for sensitive field exclusion
