---
phase: "J"
name: "Conditional Moderation Lane"
created: 2026-04-19
status: pending
---

# Phase J Context

## Goal

仅在 public open-ended 流量或 incident 证据明确要求时，引入 app-level moderation precheck/annotation，并与 code-owned `policy / scope / grounding` gate 明确分工。

## Current Truth

- 当前 repo 可识别 provider `content_filter` runtime state，也有 code-owned semantic gate
- 但还没有 app-level moderation lane
- 该 phase 是条件触发，不是当前产品默认 blocker

## Guardrails

- moderation 不能替代 code-owned `policy / scope / grounding` runtime
- 不把 moderation 实现成“敏感词拦截”回退路径
- 没有明确流量或 incident 触发前，不抢跑实现

## Entry

- `docs/plans/hallucination-governance-and-grounded-generation-execution-plan.md`
