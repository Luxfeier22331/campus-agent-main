---
doc_type: state
workstream: public-web-recent-updates-surface
status: backlog
created: 2026-04-29
updated: 2026-04-30
---

# State: Public Web Recent Updates Surface

## Current Status

- status: `backlog`
- current slice: none
- owner: unassigned
- active implementation: no
- current phase: none

## Captured Context

2026-04-30 产品需求记录：

- public web chat 希望提供一个地方让用户查看最近更新。
- 用户希望分面覆盖全部通知、schedule 通知、status 通知与 regulation 通知。
- 当前判断是新开独立 workstream 记录后续需求，不并入正在推进的 authenticated-notice retention state machine。

## Boundary Decisions

- `public-chat-web` 只拥有入口与展示体验，不拥有 updates 数据真相。
- `apps/app-api` 应作为 browser-facing updates API、visibility policy 与 response normalization owner。
- updates feed 必须读取 admitted projection/read model，不能 query-time 扫描 raw source truth、source bundle 或对象存储目录。
- regulation facet 只能展示已 promotion/admission 的 regulation truth。
- restricted authenticated notices 默认不得进入 public anonymous updates surface。

## Blockers

- 需要产品决定 recent updates 在 public web IA 中的具体入口位置与首发优先级。
- 需要冻结 `all / schedule / status / regulation` facet 的公开语义与 response schema。
- 需要确认各 admitted projection 的 public visibility policy、freshness SLA 与 fallback copy。

## Verification

- 本 workstream 当前只登记需求与边界，未执行实现验证。
- 恢复为 active 后，至少需要覆盖 projection/read-model tests、`app-api` API tests、public UI tests 与 browser smoke。

## Continuity Notes

- 不要把这个需求实现成 chat/supervisor 生成的“最近通知”回答。
- 不要把对象存储 source truth 或 collector export 当作 public browser query backing。
- 恢复执行时优先从 product/API contract 开始，再推进 projection 与 UI。
