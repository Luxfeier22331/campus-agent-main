---
phase: "E"
name: "Target-side Chunk And Quality Acceptance"
created: 2026-04-19
status: active
---

# Phase E Context

## Goal

在不扩 scope 的前提下，完成 `institutional_regulations` / `scoped_rules` 的 target-side chunk、metadata 与 quality acceptance。

## Current Truth

- 当前 bounded lane 固定为 `11` 条 admitted regulation target
- `materialized_document_count=11`
- `current_target_count=11`
- stop point 继续固定在 `offline_preparation`

## Guardrails

- 不做 unfiltered source-wide materialization
- 不碰 embedding、Qdrant、release、alias publish
- `annual rule` 缺少 `school_unit_name` 继续 fail-close

## Entry

- `docs/plans/internal-notice-policy-regulation-consumption-implementation.md`
