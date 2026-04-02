---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-04-02
---

# 当前架构

## 文档边界

本文只负责描述 `campus-agent` 当前 accepted merged-truth architecture snapshot。

它回答的是：

- 当前前向产品拓扑是什么
- 当前哪些 serving surface 已开放
- 当前 `apps/*` 与 `packages/*` 的责任边界是什么
- 当前哪些文档负责目标架构、supporting architecture 与执行状态

它不负责：

- 历史 phase 叙事
- 当前 worktree-local 未合入实现
- collection-specific cleanup / eval / rebuild 细节

## 当前拓扑

当前接受的主拓扑固定为：

`browser -> public-chat-web -> app-api -> supervisor-api -> supervisor-core -> specialist`

`browser -> protected-panel-web -> app-api -> request projection / operator read model`

`collector -> app-api official_web control plane -> ingestion-worker`

关键约束：

- browser 不直打 `apps/supervisor-api`
- panel 不绕过 `apps/app-api`
- `apps/app-api` 是唯一 product-layer auth/session/principal owner
- `apps/supervisor-api` 是 internal execution engine，不是产品后端
- online query path 与 offline data plane 持续分层

## 当前 Serving Surface

当前 query-enabled surface 固定为：

- `regulations/student_handbook`
- `curriculum/curriculum_plan`

当前非默认公开查询面：

- `curriculum/course_facts`
  specialist internal retrieval surface；`retrieval_enabled=true`，`query_enabled_by_default=false`
- `campus_services/*`
  当前仍保持 `offline_preparation`

## 当前 App 边界

### `apps/public-chat-web`

- public-facing Worker web surface
- 只负责 browser route shell 与 chat UI
- 通过 same-site/internal seam 调用 `apps/app-api`

### `apps/protected-panel-web`

- protected Worker web surface
- 只负责 operator-facing panel UI
- 通过 `apps/app-api` 消费 runtime-owned query surfaces

### `apps/app-api`

- shared Worker-native application/control-plane backend
- 拥有 auth、session、principal mapping、conversation truth、request ledger / projection input 与 selected operator surfaces
- 承接 `official_web` control plane

### `apps/supervisor-api`

- internal execution admission 与 execution transport boundary
- 接收 typed context / actor 投影
- 进入 `packages/supervisor-core -> specialist`

### `apps/ingestion-worker`

- offline ingestion/data-plane executor
- 承接 source-truth / projection / chunk / index write path

### `apps/official-web-collector`

- official web collector runtime
- 上报 crawl run lifecycle 与 artifact refs
- 不拥有 operator ledger、request projection 或 ingestion truth

## 当前 Package 边界

- `packages/supervisor-core`
  top-level request framing、routing、delegation、response finalization
- `packages/rag-specialist`
  当前默认 knowledge specialist，负责 retrieval-specific planning、clarification、grounded answer synthesis
- `packages/availability-specialist`
  已接受的非 RAG specialist capability boundary
- `packages/retrieval-core`
  retrieval abstraction、metadata pre-filter、evidence shaping
- `packages/ingestion-core`
  ingestion/data-plane consumption logic
- `packages/contracts`
  supervisor / specialist handoff 与 shared typed seam

## 当前文档地图

- 当前架构：本文
- 目标架构：`docs/architecture/target-architecture.md`
- 产品/runtime supporting architecture：`docs/architecture/product-runtime-architecture.md`
- execution/specialist supporting architecture：`docs/architecture/execution-and-specialists-architecture.md`
- identity / authorization supporting architecture：`docs/architecture/identity-and-authorization-architecture.md`
- retrieval / serving supporting architecture：`docs/architecture/retrieval-serving-architecture.md`
- data plane supporting architecture：`docs/architecture/data-plane-architecture.md`
- `official_web` supporting architecture：`docs/architecture/official-web-architecture.md`
- operator observability supporting architecture：`docs/architecture/operator-observability-architecture.md`
- 当前 phase / pending work：`.planning/PROJECT.md`、`.planning/STATE.md`

## 不在本文维护的真相

以下内容不在本文维护：

- 最新 benchmark artifact、release gate 结果、current focus
- 历史 phase 排期与执行叙事
- collection-specific normalization / rebuild / eval 证据

这些分别以 `.planning/`、`docs/runbooks/`、`docs/reference/` 为准。
