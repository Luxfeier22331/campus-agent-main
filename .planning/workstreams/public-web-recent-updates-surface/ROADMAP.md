---
doc_type: roadmap
status: backlog
created: 2026-04-29
updated: 2026-04-30
---

# Roadmap: Public Web Recent Updates Surface

当前为 backlog draft，不代表 active execution order。恢复为 active workstream 前，应重新确认 public web IA、updates API contract、可公开 source families 与 freshness SLA。

## Phase 1: Product Contract And Visibility Policy

**Goal:** 冻结“最近更新”surface 的产品边界、分面语义与 public visibility policy。

**Scope:**
- `all / schedule / status / regulation` facet definition
- public anonymous visibility policy
- card fields and pagination contract
- candidate API shape such as `GET /api/updates`
- fail-closed behavior for restricted or unadmitted rows

## Phase 2: Projection-backed Updates Feed

**Goal:** 建立只读 projection/read-model backing，不让 public surface 扫描 source truth。

**Scope:**
- notice-level query card feed source
- transport schedule update source
- service status update source
- admitted regulation update source
- freshness timestamp and rebuild metadata
- stable sorting and cursor keys

## Phase 3: App-api Updates API

**Goal:** 由 `apps/app-api` 提供 browser-facing updates API 与 response normalization。

**Scope:**
- route exposure inventory and caller class
- facet filtering and cursor pagination
- response schema and validation
- cache/no-store policy
- visibility fail-closed tests

## Phase 4: Public Web Chat UI Surface

**Goal:** 在 public web chat/public web shell 中提供可发现、可浏览的最近更新体验。

**Scope:**
- entry point and navigation placement
- facet tabs or filters
- update cards and canonical link handoff
- loading, empty and error states
- responsive layout and accessibility

## Phase 5: Acceptance And Rollout

**Goal:** 用代码、数据与浏览器证据证明 surface 可安全开放。

**Scope:**
- projection builder tests
- `app-api` route tests
- public UI tests
- browser smoke against representative update rows
- documentation and rollback notes
