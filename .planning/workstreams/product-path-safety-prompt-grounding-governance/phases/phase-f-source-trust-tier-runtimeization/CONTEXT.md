---
phase: "F"
name: "Source-Trust Tier Runtimeization"
created: 2026-04-19
status: pending
---

# Phase F Context

## Goal

把 `source-trust tier` 从 execution-plan 里的设计概念收口成 repo-owned runtime truth，进入 contracts、evidence bundle、grounding verdict 与 release-gate projection。

## Current Truth

- A-E baseline 已完成并保持 passing；latest `student_rules` artifact 继续作为 reopen anchor
- repo 当前有 `source_channel`，但还没有显式的 `source-trust tier` contract 和 `claim type x source tier x freshness` 的裁决真相
- 后续 remote-content safety 与 abuse governance 都依赖这一层先冻结

## Guardrails

- 不把 `source-trust tier` 做成无限泛化的来源评分平台
- 不用 prompt 文案或人工口径替代 contract / schema / gate
- 不回退 A-E 已通过的 `policy / scope / grounding` baseline

## Entry

- `docs/plans/archive/completed/hallucination-governance-and-grounded-generation-execution-plan.md`
