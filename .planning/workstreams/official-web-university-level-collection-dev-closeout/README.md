---
doc_type: index
status: active
created: 2026-04-28
updated: 2026-04-28
---

# Workstream: Official Web University-Level Collection Dev Closeout

这是 `official-web-university-level-collection-dev-closeout` 的 native workstream 入口。

本 workstream 只收口 official web **校级信息采集** 的本地 dev 可重复运行闭环：从
`university-core-*` scheduler lane 到 crawl artifact、source-truth validation、QC、
projection replay、projection validation、chunk audit、repeated-run evidence、
retention / alert 规则和 import/promote handoff dry-run。

## Current Status

- status: `active`
- current phase: `Phase 0`
- current slice: 新建 workstream，等待执行校级采集 dev closeout
- active implementation: planning only
- upstream evidence:
  `.planning/workstreams/official-web-collection-restart-closeout/STATE.md`
- latest accepted university-core fixed projection:
  `apps/official-web-collector/.tmp/official-web-rollout/20260427T223542Z/university-core-projection-fixed`

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- phase plans: `./phases/*/PLAN.md`

## Boundary Notes

- 本 workstream 只处理校级 official web 采集 dev closeout。
- 本 workstream 不启动院级全量采集；院级仍按 single-host validation 节奏单独推进。
- 本 workstream 不开放 `fresh_news` / `news_archive` query-serving。
- 本 workstream 不改变 retrieval runtime profile、product routing gate 或 app-api ownership。
- 本 workstream 不把 artifact-only projection replay 冒充为 registry current truth。
- import/promote 在本 workstream 中只做 dry-run / handoff readiness，不自动执行 promotion。

## Related Work

- upstream closeout: `.planning/workstreams/official-web-collection-restart-closeout/README.md`
- source config: `configs/sources/official_web/muc_public/hosts.json`
- scheduler policy: `configs/sources/official_web/muc_public/scheduler-policy.json`
- collector app: `apps/official-web-collector`
- ingestion worker: `apps/ingestion-worker`
