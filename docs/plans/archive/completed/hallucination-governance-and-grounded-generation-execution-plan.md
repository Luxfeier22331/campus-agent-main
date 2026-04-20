---
doc_type: plan
status: completed
created: 2026-04-12
updated: 2026-04-20
---

# Hallucination Governance And Grounded Generation Execution Plan

## Completion Note

这条 grounded-generation governance workstream 已关闭。
它曾负责把 repo 的 fail-close baseline 收口成更明确的 retrieval adequacy / grounding / abstain posture；当前不再作为默认执行入口。

## What This Plan Closed

- 固定了 grounded-generation 不等于 prompt-first orchestration
- 固定了 retrieval adequacy、claim support、downgrade / abstain 应分开治理
- 把这条线的实现收口为已完成 workstream，而不是长期常驻 active phase

## Current Canonical Entry

- `docs/architecture/current-architecture.md`
- `docs/architecture/execution-and-specialists-architecture.md`
- `docs/runbooks/public-product-path-safety-ops-runbook.md`
- `docs/plans/README.md`
- `.planning/WORKSTREAMS.md`

## Reopen Rule

只有在 repo 重新 admission 新的 grounded-generation runtime、claim taxonomy 扩面或 safety/eval closeout wave 时，才应新开 follow-up lane，而不是继续复用本文。
