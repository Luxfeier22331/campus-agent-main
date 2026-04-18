---
phase: "A"
name: "Auth Check And Targeted Export"
created: 2026-04-19
status: active
---

# Phase A Context

## Goal

以 `351119` 为首个 bounded slice，完成 `auth:check` 与 targeted `file_release` export。

## Current Truth

- `351119` 仍缺 target `file_release` capture/source bytes
- full export 不是当前正确动作
- downstream owner recovery consumer 仍待补齐

## Guardrails

- 不扩成 source-wide replay
- 不在这条线里改 collector foundation
- 不推进 release / alias publish

## Entry

- `docs/plans/authenticated-notice-file-release-owner-recovery.md`
