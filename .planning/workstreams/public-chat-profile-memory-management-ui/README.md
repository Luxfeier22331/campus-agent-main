---
doc_type: index
status: backlog
created: 2026-04-27
updated: 2026-04-27
---

# Workstream: Public Chat Profile Memory Management UI

这是 `public-chat-profile-memory-management-ui` 的 native backlog workstream 入口。
它记录 public chat 侧对已实现 profile memory backend 的用户可见管理入口缺口。

## Current Status

- status: `backlog`
- reopen rule: 只有在产品范围决定为 public-chat-web 暴露 end-user profile
  memory 列表、开关、删除与新增入口时恢复
- current posture: `app-api` profile memory backend、HTTP control surface 与
  execution projection 已实现；public-chat-web 尚无用户可见管理 UI

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Boundary Notes

- 这条线只承接 `public-chat-web` 的 UI / client API / browser interaction
- 不重开 `app-api` owned durable memory truth
- 不让 profile memory 参与 authorization、serving surface、approval 或 tool permission
- 不把 session slots 扩展成跨 conversation 的长期记忆
