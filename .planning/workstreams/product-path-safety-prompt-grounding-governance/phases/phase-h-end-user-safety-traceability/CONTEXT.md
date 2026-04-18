---
phase: "H"
name: "End-user Safety Traceability"
created: 2026-04-19
status: pending
---

# Phase H Context

## Goal

为终端用户在线问答补 `safety_identifier` 或等价匿名化安全标识，并把 provider-side traceability、request observability 与隐私约束对齐。

## Current Truth

- app-api 已有 request observability 和 telemetry sanitization
- 但当前 prompt runtime payload 还没有终端用户级安全追踪标识
- 这一 phase 只处理 traceability，不单独扩成 moderation 或 abuse platform

## Guardrails

- 不把可识别个人信息直接透传给 provider 或 telemetry sink
- 不绕过现有的 prompt / answer / auth secret 清洗边界
- 不把 traceability 误写成用户画像或权限系统

## Entry

- `docs/plans/hallucination-governance-and-grounded-generation-execution-plan.md`
