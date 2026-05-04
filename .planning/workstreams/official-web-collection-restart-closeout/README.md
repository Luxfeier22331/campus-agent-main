---
doc_type: index
status: completed
created: 2026-04-28
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Workstream: Official Web Collection Restart Closeout

这是 `official-web-collection-restart-closeout` 的 native workstream 入口。

它记录旧的 official web 采集重启方案的本地闭环证据、边界和遗留 ops 缺口。
这条线现在已经被 one-time source-pack 路线取代，不再作为 forward implementation lane。

## Current Status

- status: `completed`
- current phase: `Superseded closeout`
- current slice: 历史 bounded crawl / projection replay / repair evidence 保留，仅作为后续
  source-pack 路线的背景参考；不再继续补 scheduler、alert、deployment 或 recurring collector
  ops
- active implementation: no
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
- downstream replacement:
  `../official-web-tool-driven-source-pack/README.md`
- execution replacement:
  `../official-web-source-pack-collection-execution/README.md`

## Boundary Notes

- 本 workstream 只保留旧 official web 采集重启方案的历史证据。
- 本 workstream 不把 `fresh_news` 或 `news_archive` 提升为默认 query-serving surface。
- 本 workstream 不把 projection replay 产物冒充为 registry current truth。
- 本 workstream 不重开 backlog 中的 `official-web source channel / news opening`。
- 本 workstream 不改写 `apps/app-api` 对 official web control-plane 的 ownership。
- 本 workstream 不改变 retrieval serving profile、product routing gate 或 accepted merged truth。
- 本 workstream 不再拥有 forward collector automation、scheduler rollout、retention、
  alert、deployment handoff 或 no-promotion live seam 实现。

## Superseded By

- `official-web-targeted-collection-refactor`:
  collector 已改为 target-first executor，而不是 broad crawl scope owner
- `official-web-tool-driven-source-pack`:
  official-web 首期范围已改为 tool-demand-driven one-time source pack
- `official-web-source-pack-collection-execution`:
  one-time capture / replay / no-promotion seam / ingestion-owned selected-write admission
  已完成并关闭

因此，这条 workstream 中原本未完成的 scheduler、preflight、retention、alert、deployment
handoff 等 recurring collector work 不再进入实现队列。

## Related Work

- backlog workstream: `official-web-source-channel-news-opening`
- historical entry: `docs/plans/archive/historical/official-web-source-channel-news-opening.md`
- ingestion deployment hardening: `.planning/workstreams/ingestion-worker-independent-deployment-hardening/README.md`
