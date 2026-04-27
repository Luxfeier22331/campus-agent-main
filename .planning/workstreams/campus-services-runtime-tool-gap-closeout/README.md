---
doc_type: index
status: active
created: 2026-04-27
updated: 2026-04-27
---

# Workstream: Campus Services Runtime Tool Gap Closeout

这是 `campus-services-runtime-tool-gap-closeout` 的 native active workstream 入口。
它记录 `campus-services-agent` 当前 structured runtime tools 在 product-path opening 前仍需收口的缺口。

## Current Status

- status: `active`
- active implementation: yes
- current phase: `Phase 1`
- current slice: `service_status_lookup` precedence / conflict regression follow-up
- reopen rule: 只有在 product path 准备打开或强化 `service_status_lookup`、
  `transport_schedule_lookup`、`service_guide_lookup`、`contact_directory_lookup`
  的真实用户可用性时恢复

## Native Planning Truth

- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Boundary Notes

- 本 workstream 只处理 runtime tool readiness、routing、answer shaping、source trace、
  observability 与 eval gate
- 本 workstream 不重开 authenticated notice collection、OCR/table parser、source-truth
  inventory 或 projection build 架构
- backing projection 缺数据时，本 workstream 只能暴露 fail-close 与 data-plane gap，
  不能让 runtime query-time 回扫 raw source
- public/chat 真实入口 E2E 的产品级验收由
  `public-chat-campus-services-e2e-acceptance` 承接；本 workstream 可提供 tool-level
  deterministic denominator
