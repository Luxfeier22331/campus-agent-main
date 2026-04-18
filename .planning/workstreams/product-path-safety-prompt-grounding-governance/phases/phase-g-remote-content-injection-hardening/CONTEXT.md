---
phase: "G"
name: "Remote-content Injection Hardening"
created: 2026-04-19
status: pending
---

# Phase G Context

## Goal

为 `official_web` 与未来 live/authenticated source surfaces 建立 remote-content sanitization、prompt-injection suspicion 标注与 regression gate，确保外部内容只作为数据进入 runtime。

## Current Truth

- prompt runtime 已把 user input / retrieved evidence 视为 untrusted data
- 但 repo 还缺少针对 remote content 的专门 sanitization、injection suspicion 标注和 focused regression coverage
- Phase G 必须建立在 Phase F 的 source-trust contract 之上

## Guardrails

- 不把 remote-content hardening 做成通用 HTML 清洗平台
- 不以关键词黑名单替代结构化 suspicion / gate
- 不把单次 provider content filter 命中冒充成应用自己的 injection 防线

## Entry

- `docs/plans/hallucination-governance-and-grounded-generation-execution-plan.md`
