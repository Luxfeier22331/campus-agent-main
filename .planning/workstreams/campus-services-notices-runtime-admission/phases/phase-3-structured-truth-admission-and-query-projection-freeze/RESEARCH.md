---
phase: "3"
artifact: "research"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 3 Research

## Purpose

把 `Phase 3` 的 projection freeze 建立在三类 repo-local truth 之上：

- `service_catalog` handbook-derived hybrid materialization pattern
- `official_web` projection declaration / routing / validation pattern
- `internal_notice` source projection / restricted notice family posture

## Official References Consulted

- 无新增外部资料。
- 本 phase 的核心问题是 repo 内 source-truth / projection owner，而不是外部平台能力边界。

## Repo Pattern Readings

- `docs/architecture/retrieval-serving-architecture.md`
- `docs/architecture/official-web-serving-and-news-retrieval-strategy.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `configs/ingestion/campus_services/service_catalog/runtime-profile.json`
- `configs/ingestion/campus_notices/internal_notice/runtime-profile.json`
- `configs/ingestion/official_web/fresh_news/runtime-profile.json`
- `packages/contracts/src/campus_contracts/models.py`
- `packages/ingestion-core/src/campus_ingestion_core/handbook_service_navigation_hybrid_materialization.py`
- `packages/ingestion-core/src/campus_ingestion_core/official_web_projection.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py`

## Standard Stack

- projection-backed structured truth
  - repo 当前已经反复把 source-truth、projection、document truth、chunk/index 分层。
  - 对这条 workstream，最正确的 query seam 也必须继续读 projection / normalized truth，而不是跳回 raw asset 或 retrieval alias。
- per-source-family projection owner
  - `official_web` 已有 projection declarations/routing；`internal_notice` 已有 source projection / attachment projection owner。
  - 说明 public notice family 与 restricted notice family 应继续先各自成形，再被 future notice runtime 并排消费。
- query-enabled gate remains explicit
  - 三个相关 runtime profile 仍然都不是 query-enabled。
  - 因此 `Phase 3` 不能偷换成 “直接开放内部 retrieval 查询”，而只能冻结 future internal query service 所需 projection owner。

## Architecture Patterns

- service status is not text retrieval
  - `service_catalog` 当前虽然有 canonical markdown / document units / hybrid materialization pattern，但它仍不是 runtime query surface。
  - `service_status_lookup` 应消费更窄的 current-effective status projection，而不是“把 service_catalog 当知识库搜一下”。
- transport schedule is not navigation ownership
  - transport route/window/stop truth 未来可以被 `navigation-agent` 消费 point refs，但 timetable truth owner 不应被导航 family 吸收。
  - 因此 `transport_schedule_lookup` 需要自己的 projection owner，并把 point refs 作为 output，而不是把 source truth 让给 navigation。
- notice runtime is not fresh-news opening
  - `official_web/fresh_news` 的 freshness-sensitive retrieval branch 与 notice runtime 是并列关系。
  - public notice family 可以来自 `official_web` notice-like pages，但这不等于 `fresh_news` 已经 reopening。
- restricted notice stays restricted
  - `internal_notice` 当前 posture 仍是 restricted source-channel triage collection。
  - 即使 future notice runtime 消费它，也只能以 restricted notice source family 的形式被投影和过滤，不能假装成公开 surface。

## Don't Hand-Roll

- 不要把 query-disabled runtime profile alias 当成 future internal query API。
- 不要让 `campus_notice_discover/get` 在 query time 直接扫描 raw notice/source bundle。
- 不要让 `service_status_lookup` / `transport_schedule_lookup` 回到 generic RAG。
- 不要把 public notice projection 与 restricted notice projection 提前混成一个无 source-family 区分的表面。

## Common Pitfalls

- projection 和 opening 混层
  - “已经有 projection” 不等于 “已经开放 query-serving”。
- retrieval alias 幻觉
  - 看到 collection 已有 canonical markdown / chunk，不代表它可以直接成为 structured runtime query seam。
- public/restricted 混平
  - 如果不先把 `official_web` 与 `internal_notice` 的 query projection 分开，后续 authorization 与 fail-close 很快会失真。
- point refs 与 truth owner 倒置
  - `navigation-agent` 可以消费 stop refs，但这不代表它拥有 transport timetable truth。

## Conclusions For Phase 3

1. `Phase 3` 应先冻结 tool-to-projection ownership，而不是先写 query service。
2. `service_status_lookup` / `transport_schedule_lookup` 必须继续走 projection-backed structured truth。
3. `campus_notice_discover/get` 必须继续保留 public/restricted source-family split。
4. `Phase 4` 只有在 query projection shape 与 required metadata 冻结后，才适合开始 wiring。
