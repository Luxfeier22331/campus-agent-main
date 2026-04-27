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
- current slice: 本地 `official_web -> fresh_news` dry-run、真实 batch、DB inspection 与局部验证已完成；后续收口 scheduler / preflight / retention / alert / 重复运行验收
- active implementation: yes, planning and ops follow-up only
- latest successful run id: `e0ed85dd-81fc-4882-b122-dae0246ac524`
- latest report: `.tmp/official-web-restart-batch/official_web_batch_e0ed85dd-81fc-4882-b122-dae0246ac524.json`

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Boundary Notes

- 本 workstream 只处理 official web 采集重启、dev/local batch 证据和部署前 ops 缺口记录。
- 本 workstream 不把 `fresh_news` 或 `news_archive` 提升为默认 query-serving surface。
- 本 workstream 不重开 backlog 中的 `official-web source channel / news opening`。
- 本 workstream 不改写 `apps/app-api` 对 official web control-plane 的 ownership。
- 本 workstream 不改变 retrieval serving profile、product routing gate 或 accepted merged truth。

## Related Work

- backlog workstream: `official-web-source-channel-news-opening`
- historical entry: `docs/plans/archive/historical/official-web-source-channel-news-opening.md`
- ingestion deployment hardening: `.planning/workstreams/ingestion-worker-independent-deployment-hardening/README.md`
