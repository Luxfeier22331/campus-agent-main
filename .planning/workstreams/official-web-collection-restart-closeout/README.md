---
doc_type: index
status: active
created: 2026-04-28
updated: 2026-04-28
---

# Workstream: Official Web Collection Restart Closeout

这是 `official-web-collection-restart-closeout` 的 native workstream 入口。

它记录本轮 official web 采集重启的本地闭环证据、边界和后续 ops 缺口。

## Current Status

- status: `active`
- current phase: `Phase 2`
- current slice: 本地 `official_web` source-truth projection replay 已完成，当前 replay 产物为
  `85` 个 documents：`75` 个 `muc_public_pages`、`10` 个 `stable_reference`
- active implementation: yes, planning and ops follow-up only
- latest projection artifact:
  `.tmp/official-web-restart/official-web-restart-20260427T213902Z/projection-replay.json`
- latest validation artifact:
  `.tmp/official-web-restart/official-web-restart-20260427T213902Z/projection-validation.json`
- current `.env` registry count for `official_web/*`: `0` records across
  `muc_public_pages` / `stable_reference` / `fresh_news` / `news_archive`

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Boundary Notes

- 本 workstream 只处理 official web 采集重启、dev/local projection evidence 和部署前 ops 缺口记录。
- 本 workstream 不把 `fresh_news` 或 `news_archive` 提升为默认 query-serving surface。
- 本 workstream 不把 projection replay 产物冒充为 registry current truth。
- 本 workstream 不重开 backlog 中的 `official-web source channel / news opening`。
- 本 workstream 不改写 `apps/app-api` 对 official web control-plane 的 ownership。
- 本 workstream 不改变 retrieval serving profile、product routing gate 或 accepted merged truth。

## Related Work

- backlog workstream: `official-web-source-channel-news-opening`
- historical entry: `docs/plans/archive/historical/official-web-source-channel-news-opening.md`
- ingestion deployment hardening: `.planning/workstreams/ingestion-worker-independent-deployment-hardening/README.md`
