---
phase: "6"
name: "Institutional Regulations Target Chunk-Prep Parity"
created: 2026-04-20
status: pending
---

# Phase 6 Context

## Goal

补齐 `regulations/institutional_rules` 的 repo-native target-side chunk-prep / validation lane，使其与现有 `scoped_rules` acceptance seam 达到同级能力。

## Current Truth

- `scoped_rules` 当前已经具备 local-only target-side chunk acceptance seam
- `institutional_rules` 当前仍缺正式收口的 repo-native parity lane
- 当前 formal local target 固定仍是 `11` 条 admitted target 中的 `institutional_rules + scoped_rules` 双 lane

## Guardrails

- 不回到 source-wide replay 或 unfiltered materialization
- 不把 acceptance worker 继续串到 embedding、Qdrant、release 或 alias publish
- 只处理 target snapshot -> local-only chunk artifacts 这一层

## Entry

- `docs/runbooks/internal-notice-regulation-target-quality-acceptance-runbook.md`
- `docs/reference/institutional-regulations-promotion-quality-acceptance.md`
