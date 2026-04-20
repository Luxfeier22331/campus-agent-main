---
doc_type: plan
status: historical
created: 2026-03-22
updated: 2026-04-20
---

# Supervisor 当期设计架构实施方案

## Historical Note

本文只保留早期 supervisor implementation baseline 的路径连续性。
当前 supervisor 真相已经收回到 architecture / ADR，不再通过这份早期实施方案表达。

## Retained Meaning

- 这份旧计划曾负责把 `supervisor-core` 从薄透传收口到单 specialist 协调层
- 它的历史价值在于说明 repo 早期如何固定 `supervisor-api -> supervisor-core -> rag-specialist` 的主链路职责

## Current Canonical Entry

- `docs/architecture/current-architecture.md`
- `docs/architecture/execution-and-specialists-architecture.md`
- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`

如需完整旧正文，请通过 git history 追溯。
