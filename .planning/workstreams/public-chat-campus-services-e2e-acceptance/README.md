---
doc_type: index
status: backlog
created: 2026-04-27
updated: 2026-04-27
---

# Workstream: Public Chat Campus Services E2E Acceptance

这是 `public-chat-campus-services-e2e-acceptance` 的 native backlog workstream 入口。
它记录 public/chat 入口到 `campus-services-agent` structured tools 的产品级 E2E 验收缺口。

## Current Status

- status: `backlog`
- reopen rule: 只有在 product path 准备验证 `campus-services-agent` 从 public/chat 入口到 structured tool 消费的真实用户路径时恢复
- current posture: internal structured query 和 agent adapter 已有 focused 验证；public/chat 入口 E2E 尚未作为 release gate 固化

## Native Planning Truth

- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Boundary Notes

- 这条线只验证 public/chat 真实入口、planner/router 选择、agent handoff、tool 消费与最终回答呈现
- 这条线不重开 ingestion source-truth、notice consumption projection 或 PG structured projection 架构
- 这条线不替代 `apps/supervisor-api/internal/structuredquery` 的 unit/integration tests
- 这条线不把 `campus-services-agent` 扩成通用 RAG 或 notice text search owner
