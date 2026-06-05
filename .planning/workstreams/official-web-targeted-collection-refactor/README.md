---
doc_type: index
status: completed
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Workstream: Official Web Targeted Collection Refactor

这是 `official-web-targeted-collection-refactor` 的 native workstream 入口。

本 workstream 负责把 `official_web` 采集从当前 crawl-first / broad-host 形态重构为
target-first collection pipeline：先由下游消费目标声明需要什么，再由 `app-api` 生成
target-scoped workset，collector 只执行已准入的 fetch / snapshot / normalize / upload。

## Current Status

- status: `completed`
- current phase: `Phase 9 complete`
- current slice: target-first official-web collection refactor completed
- active implementation: no
- owner: Codex session

## Target Shape

目标链路固定为：

`downstream target declaration -> app-api target job/admission -> collector fetch executor -> source-truth artifacts -> app-api run/page ledger -> ingestion-worker projection/review/release gate`

关键分工：

- `target-source-map` 从采集提示升级为 target admission truth。
- `hosts.json` / `seeds.json` 从默认 frontier 降级为 source capability registry。
- `consumer-denominator` 从抓后主驱动降级为 retained source-truth / review gate。
- collector 不再决定下游是否可写，只报告 source facts 和 artifact refs。
- ingestion-worker 继续拥有 replay、projection、selected-write 与 release gate。
- protected panel 只消费 `app-api` operator projection，不读对象存储、collector 本地输出或 worker inbox。

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
- closeout evidence: `./CLOSEOUT.md`
- completed phase summaries:
  `./phases/phase-00-boundary-and-freeze/SUMMARY.md` through
  `./phases/phase-09-legacy-closeout-and-acceptance/SUMMARY.md`

## Implementation Result

- official-web collection defaults to app-api target workset admission.
- collector no longer turns host allowlists or seeds into collection scope.
- target lineage is carried through source-truth artifacts, app-api page observations,
  target attempts and ingestion reports.
- no-promotion live seam writes staged ingestion evidence without current-truth promotion.
- legacy broad crawl remains explicit debug/operator-only and excluded from handoff/promotion.

## GSD Status Contract

GSD tooling treats any `PLAN.md` without `SUMMARY.md` as `in_progress`.

Therefore this workstream keeps only the current executable phase as `PLAN.md`.
Future phases are stored as `OUTLINE.md` until the previous phase is closed and
the next phase contract is ready to execute.

## Boundary Notes

- 本 workstream 不打开 `official_web/fresh_news` 或 `official_web/news_archive` runtime。
- 本 workstream 不改变 `official_web/stable_reference` 当前 query-enabled posture。
- 本 workstream 不把 panel 扩成 collector 操作后端。
- 本 workstream 不让 collector 直接写 document registry、selected-write current truth 或 retrieval index。
- 本 workstream 不引入新的 `college_web` / `department_web` source channel。
- 本 workstream 可以复用 shared source-handoff / ingestion-execution 状态机，但不重开其基础设计。
- 本 workstream 不处理 authenticated notice、wechat official account 或 public recent updates surface。

## Related Work

- current closeout lane: `.planning/workstreams/official-web-collection-restart-closeout/README.md`
- completed consumer denominator recovery:
  `.planning/workstreams/official-web-consumer-denominator-recovery/README.md`
- shared source handoff state machine:
  `.planning/workstreams/source-handoff-ingestion-state-machine-design/README.md`
- official-web architecture:
  `docs/architecture/domains/official-web/architecture.md`
- source-truth schema:
  `docs/data/official-web-source-truth-schema.md`
