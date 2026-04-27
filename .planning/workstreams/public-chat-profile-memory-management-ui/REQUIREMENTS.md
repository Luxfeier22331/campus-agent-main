---
doc_type: requirements
status: backlog
created: 2026-04-27
updated: 2026-04-27
---

# Requirements: Public Chat Profile Memory Management UI

## Goal

在 public-chat-web 中补齐用户可见的 profile memory 管理体验，让用户能查看、
添加、删除并关闭长期记忆投影，同时保持 memory 只用于 personalization，不参与权限或
retrieval ACL。

## Captured Gaps

1. public-chat-web 没有 `/api/me/profile-memory` 的 typed client wrapper。
2. public-chat-web 没有 profile memory 列表入口。
3. public-chat-web 没有启用/关闭 profile memory projection 的 UI。
4. public-chat-web 没有用户手动新增记忆 item 的 UI。
5. public-chat-web 没有删除已有 memory item 的确认交互。
6. public-chat-web 没有解释 `enabled=false` 不删除已有 item、只影响后续
   execution projection。

## In Scope

- public-chat-web typed API wrapper 与 response mapping
- 用户可见 profile memory settings / list / add / delete UI
- 关闭 projection 的状态展示与恢复入口
- 空状态、错误状态、加载状态与 basic optimistic refresh
- 现有 app shell / sidebar / user menu 内的入口设计
- browser tests 与 worker proxy contract tests

## Non-goals

- 新增第二套 memory backend
- 修改 `app-api` profile memory schema 或 supervisor projection contract
- 自动从对话中抽取或提升 memory candidate
- 让 memory 影响 authorization、serving surface、approval 或 tool permission
- 把 `chat.session_slots` 暴露为长期记忆管理对象

## Success Criteria

1. 已登录用户能在 public-chat-web 中看到自己的 profile memory 状态与 item 列表。
2. 用户能手动新增 user-declared memory item，并看到保存后的 normalized 结果。
3. 用户能删除自己的 memory item，并且删除后 UI 不再展示该 item。
4. 用户能关闭和重新开启 profile memory projection，且 UI 明确说明关闭不会删除已有 item。
5. 401 / 403 / 400 / 5xx 错误有用户可理解的 fail-closed 展示。
6. 新 UI 不暗示 memory 会改变权限、资料可见范围或工具能力。
7. public-chat-web tests 覆盖 list、toggle、add、delete、empty/error states 与
   worker proxy forwarding。

## Canonical Entry

- `.planning/workstreams/public-chat-profile-memory-management-ui/README.md`
