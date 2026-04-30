---
doc_type: index
status: backlog
created: 2026-04-29
updated: 2026-04-30
---

# Workstream: Public Web Recent Updates Surface

这是 `public-web-recent-updates-surface` 的 native backlog workstream 入口。
它记录 public web chat 侧“最近更新”浏览入口的后续产品需求：用户可以查看最近更新的全部通知、schedule 通知、status 通知与 regulation 通知。

## Current Status

- status: `backlog`
- reopen rule: 只有在产品范围决定实现 public recent updates surface、`app-api` updates API，或需要把 admitted notice-derived read models 暴露给 public browser surface 时恢复
- current posture: 已登记需求与边界；不进入当前 authenticated-notice retention state machine 执行链路

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Boundary Notes

- public web chat 可以拥有“最近更新”入口与展示体验，但不拥有通知、班车、服务状态或 regulation 的数据真相
- `apps/app-api` 是 browser-facing updates API 与 visibility policy owner
- 最近更新列表必须读取 admitted projection / read model，不得 query-time 回扫 raw source bundle、对象存储 source truth 或原始 notice HTML
- regulation facet 只能展示已 promotion/admission 的 regulation truth，不展示候选或未通过质量门的 notice-derived 内容
- restricted authenticated notices 不得暴露给 public anonymous surface
