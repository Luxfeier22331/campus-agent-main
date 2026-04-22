---
phase: "1"
artifact: "research"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 1 Research

## Purpose

把 `Phase 1: Source Family Boundary` 建立在两类事实之上：

- repo 已冻结的 notice source-truth、retrieval/runtime split、restricted posture 与 tool/runtime contract
- 官方网页面结构的有限联网 sanity-check，用来验证 public `notice` 与 broader `news` 的分面在现实中确实存在，但不让外部网页覆盖 repo truth

## Repo Pattern Readings

- `docs/plans/archive/completed/notice-consumption-layer.md`
- `.planning/workstreams/notice-consumption-layer/REQUIREMENTS.md`
- `.planning/workstreams/notice-consumption-layer/ROADMAP.md`
- `.planning/workstreams/notice-consumption-layer/STATE.md`
- `packages/contracts/src/campus_contracts/models.py`
- `docs/architecture/current-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/domains/official-web/architecture.md`
- `docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice-source-truth-schema.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-1-agent-and-tool-boundary-freeze/CONTEXT.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-1-agent-and-tool-boundary-freeze/PLAN.md`

## Official Web Sanity-Check References

- 中央民族大学官网新闻入口：
  - https://www.muc.edu.cn/xwzx.htm
- 中央民族大学官网通知入口：
  - https://www.muc.edu.cn/tzgg.htm

说明：

- 这些官方页面只用于 sanity-check “public notice” 与 “broader news” 在真实官网中通常是分面存在的。
- 这不是 repo source-of-truth；repo 级边界仍以本地 architecture / planning 文档为准。

## Findings

### 1. Repo 已经有 notice source family 的闭集真相

- `packages/contracts` 已冻结 `NoticeSourceFamily` 为：
  - `official_web_public_notice`
  - `internal_notice_restricted`
- `Phase 1` 的正确动作是把这两个 family 的消费边界写清，而不是再发明第三个 family。

### 2. Repo 已经有 public notice runtime 与 news retrieval 的分层真相

- `official_web-serving-and-news-retrieval-strategy` 已明确：
  - `fresh_news` 是 freshness-sensitive retrieval surface
  - structured notice runtime 处理显式 notice task
  - public notice runtime 与 restricted notice runtime 是否共用 source matrix，必须靠显式 contract 冻结
- 所以 `Phase 1` 不该讨论“先开新闻面再顺带吸收 notice”，而应先冻结 notice family boundary。

### 3. Repo 已经有 restricted notice posture 的真相

- `internal_notice` 当前仍是 restricted、`offline_preparation`、`query_enabled_by_default=false`
- future restricted notice runtime 也只能读取 projected notice metadata / canonical body truth
- 这意味着 `internal_notice_restricted` 在 `Phase 1` 中只能被建模成 future source family，不是当前可直接消费的 query surface。

### 4. `source_notice` 必须继续是 canonical upstream unit

- authenticated notice source-truth contract 已经把 canonical upstream 锚定为稳定 `notice` 资源
- 因此 `derived consumption unit` 只能是 source-notice-backed typed projection，不能反过来替代 source truth
- 同样，public notice family 进入 structured runtime 时，也应保持 `source_notice` 语义，而不是退化成 `fresh_news` retrieval document

### 5. 网联 sanity-check 支持“public notice 是 news 的子集，而不是同义词”

- 官方站点当前存在单独的 `新闻资讯` 入口与单独的通知页入口，这支持以下 repo-level 推断：
  - public notice-like page family 可以作为 `official_web_public_notice`
  - broader `news` 仍应留在 `fresh_news`
- 这是对 repo 既有判断的外部验证，不是新的上位决策。

## Phase-1 Decisions To Freeze

1. 两个 admitted source family 保持闭集：
   - `official_web_public_notice`
   - `internal_notice_restricted`
2. `source_notice`、`notice_attachment`、`derived consumption unit` 继续是三层模型：
   - upstream canonical truth
   - relation truth
   - consumption projection
3. `official_web_public_notice` 不是整个 `official_web`，也不是整个 `fresh_news`；它只表示可进入 notice task routing 的 public notice-like subset。
4. `internal_notice_restricted` 继续保持 restricted/offline-preparation posture；当前只冻结建模边界，不打开 query-serving。
5. `Phase 1` 只冻结 role taxonomy 边界与 admissible examples，不冻结正式字段 schema。
6. authority / completeness 问题必须被显式后送到 `Phase 3`，不能被 `Phase 1` 静默略过。

## Deferrals

- `Phase 2`
  - `primary_role`
  - `semantic_owner`
  - `default_agent`
  - `target_surface`
  - `temporal_policy`
  - `completeness_status`
  等正式 schema
- `Phase 3`
  - notice body / attachment body / wrapper text authority
  - `attachments_declared` / `attachments_captured`
  - `authoritative_attachment_missing`
  - answerability / fail-close
- `Phase 4-5`
  - agent handoff
  - worked example
  - adoption route

## Risks If Mis-Scoped

- 如果把 `official_web_public_notice` 和 `fresh_news` 混成一层，后续会把 notice runtime 错做成 retrieval alias。
- 如果把 `internal_notice_restricted` 误当作“当前可查的 restricted notice 面”，会直接撞上 repo 已冻结的 `offline_preparation` posture。
- 如果让 `derived consumption unit` 反向取代 `source_notice`，后续 authority、completeness 与 provenance 都会失真。
- 如果 `Phase 1` 就试图冻结全部 schema 和 authority，phase scope 会失控，`Phase 2-3` 失去存在意义。

## Conclusions For Phase 1

1. 先冻结 source family boundary，而不是先开新闻面。
2. 先写清 `source_notice -> multiple derived consumption units` 的层次，再定义字段。
3. 保持 public notice runtime、restricted notice runtime、freshness-sensitive news retrieval 三者分层。
4. 让 `Phase 2` 接 schema，`Phase 3` 接 authority/completeness，形成明确 handoff。
