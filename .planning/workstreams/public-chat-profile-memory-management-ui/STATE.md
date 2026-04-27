---
doc_type: state
status: backlog
created: 2026-04-27
updated: 2026-04-27
---

# State: Public Chat Profile Memory Management UI

## Current Status

- status: `backlog`
- current slice: none
- owner: unassigned
- active implementation: no

## Captured Context

2026-04-27 代码级确认：

- `app-api` 已拥有 profile memory backend、schema、migration、HTTP routes 与
  supervisor context projection。
- 长期记忆接口已包括 list、upsert、settings toggle 与 delete。
- `public-chat-web` 当前会代理 `/api/*` 到 `app-api`，但没有 profile memory client API wrapper。
- `public-chat-web` 当前没有用户可见的 memory settings、memory list、delete 或 add/edit UI。

## Blockers

- 需要产品确认该 UI 进入首屏 chat shell、用户菜单、settings panel，还是独立 route。
- 需要确认新增记忆入口是否只支持用户手动声明，还是允许从对话中提升候选记忆。
- 需要确认中文 UI 文案、空状态、关闭 projection 后的解释，以及删除确认交互。

## Verification

- 本 backlog 捕获来自 profile memory backend 实现后的缺口确认；未执行前端实现验证。
- 恢复为 active 后，至少需要覆盖 public-chat-web unit/component tests、
  worker proxy tests、app-api route contract assumptions，以及浏览器 smoke。

## Continuity Notes

- 使用现有 `/api/me/profile-memory*` endpoints，不新增第二套 browser backend。
- `profileMemory.enabled=false` 只关闭 execution projection，不删除已有 item；UI 文案必须体现这一点。
- UI 不展示或暗示任何权限、角色、ACL、可见性提升语义。
