---
doc_type: roadmap
status: backlog
created: 2026-04-27
updated: 2026-04-27
---

# Roadmap: Public Chat Profile Memory Management UI

当前为 backlog draft，不代表 active execution order。恢复为 active workstream 前，
应重新确认入口位置、交互范围与验收 smoke。

## Phase 1: Client Contract And UI Entry

**Goal:** 在 public-chat-web 中建立 profile memory 的 typed client API 和用户入口。

**Scope:**

- `GET /api/me/profile-memory`
- `POST /api/me/profile-memory/items`
- `PATCH /api/me/profile-memory/settings`
- `DELETE /api/me/profile-memory/items/:itemId`
- route / user menu / settings panel 入口决策

## Phase 2: Memory List And Settings UI

**Goal:** 实现用户可见的 memory list、enabled toggle、空状态和错误状态。

**Scope:**

- loading / empty / error states
- enabled / disabled copy
- item metadata display
- no authz implication copy

## Phase 3: Add And Delete Interactions

**Goal:** 补齐手动新增和删除 memory item 的交互闭环。

**Scope:**

- key/value input
- validation feedback
- delete confirmation
- refresh / optimistic update

## Phase 4: Verification And Smoke

**Goal:** 用自动化和浏览器 smoke 证明 UI 与 app-api memory backend 一致。

**Scope:**

- public-chat-web unit/component tests
- worker proxy tests
- app-api contract fixture assumptions
- authenticated browser smoke
