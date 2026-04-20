---
phase: "I"
name: "Abuse Controls And Security Ops Loop"
created: 2026-04-19
status: pending
---

# Phase I Context

## Goal

为 public/product-path 补最小滥用控制、异常信号、operator alerts 与 incident backfill hooks，把当前“质量观测为主”提升到最小可用的产品侧安全运营闭环。

## Current Truth

- repo 已有 operator observability / telemetry sink / incident backfill vocabulary
- 但当前在线问答主路径仍缺最小 abuse controls、异常告警与 security-ops 风格的回灌闭环
- 这条线仍是产品级治理，不是厂商级 safety operations platform

## Guardrails

- 不引入与当前产品范围不相称的大而全安全平台
- 不让 abuse controls 反向定义 prompt/runtime 边界
- incident backfill 必须回到 eval / gate，而不是停在 dashboard annotation

## Entry

- `docs/plans/archive/completed/hallucination-governance-and-grounded-generation-execution-plan.md`
