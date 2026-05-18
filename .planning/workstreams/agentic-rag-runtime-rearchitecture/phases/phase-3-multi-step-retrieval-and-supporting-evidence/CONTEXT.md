---
doc_type: context
status: active
created: 2026-05-04
updated: 2026-05-04
---

# Phase 3 Context

## Why This Phase Exists

单轮 planner-first 仍不够。目标架构要求 bounded multi-step retrieval、replan、
supporting evidence selection，以及对 upstream bounded context 的安全消费。
但这不是重新做 retrieval baseline：completed baseline 已经给出 typed plan / multi-step
executor 的长期方向，本 phase 只把 rag-agent 适配到那条 seam 上。

## Repo Facts

- bounded retrieval baseline 已经提供 typed plan / multi-step executor 的上游思路。
- rag-agent 仍需把这套能力真正接回内部 runtime，而不是停留在文档层。
- upstream bounded context 必须保持 typed projection，不得回退 raw transcript。
  这里允许的 upstream projection 主要是 `CanonicalNoticeContext`、`NoticeChangeSet`、
  `ScheduleBaseline`、`PlaceContext`、`EvidenceBundle` 与 `GroundingVerdict`。

## Output Of This Phase

- bounded multi-step retrieval seam
- supporting evidence selection 的显式化
- upstream bounded context consumption 规则
- 相对 baseline 的新增能力 / 不变能力 可以被明确区分
