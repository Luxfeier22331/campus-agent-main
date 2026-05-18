---
doc_type: requirements
status: active
created: 2026-05-01
updated: 2026-05-01
---

<!-- markdownlint-disable MD013 -->

# Requirements: Source Handoff Ingestion State Machine Design

## Goal

为两个 collector 和一个 ingestion-worker 冻结统一的跨 runtime 状态机设计：

```text
source-specific collector run
  -> shared source handoff
  -> object verification
  -> shared ingestion execution
  -> source-specific projection / admission / promotion
```

目标不是把两个 collector 合并，而是把它们进入 ingestion-worker 后的 handoff、验证、执行、重试、
operator evidence 与 closeout 语义统一。

## Background

当前 repo 事实：

- `official_web` 已有 app-api-owned crawl-run ledger、heartbeat、artifact refs、page
  observations、outbox 和 operator projection。
- `official_web` worker handoff 已能下载 source-truth bundle、materialize replay input、运行
  projection validation、chunk audit、stage / promote，并把 execution status 回报给 app-api。
- `authenticated_notice_portal` 已有 object-native handoff、collector run ledger、bundle /
  manifest / required source object verification、run-level queue、child task state 与 processor
  profile。
- 两条链路都产出 object storage artifacts，并最终由 `apps/ingestion-worker` 消费。
- 两条链路的状态与 evidence 形态仍分裂：official-web 依赖 app-api status columns 与 worker
  local JSON record；authenticated-notice 已有更强的 run-level queue / verification / child-task
  状态，但只服务自己的 source channel。

## In Scope

- Canonical terminology for source run, source handoff, source object, object verification,
  ingestion execution, execution step, child task and processor profile.
- Shared handoff payload shape for `official_web` and `authenticated_notice_portal`.
- Required object roles and hash/size verification semantics.
- Shared ingestion execution state machine with lease, retry, cancellation, dead-letter and
  terminal success semantics.
- Shared step state machine for verify / replay / import / projection / validation / chunk audit /
  media gate / target admission / downstream materialization / promotion / cleanup guard.
- Source-channel adapter responsibilities for official-web and authenticated-notice.
- Store ownership and projection rules across `packages/ingestion-core`, `apps/ingestion-worker`
  and `apps/app-api`.
- Migration plan from current official-web local JSON handoff records and authenticated notice
  queue states to canonical projections.
- Verification gates for contract tests, store tests, source-specific adapter tests, worker
  execution tests and no-serving-opening smoke.

## Non-Goals

- No merger of the two collectors.
- No rewrite of collector frontier, browser provider, portal authentication or URL admission rules.
- No direct collector writes to source-truth registry, document registry, projection read model,
  chunk, index or serving alias.
- No use of local filesystem paths as production handoff truth.
- No panel-owned state machine or telemetry-sink-owned state machine.
- No new query-serving surface or runtime opening.
- No replacement of existing source-specific run ledgers in the first implementation slice.
- No introduction of Temporal / Argo / Dagster as required runtime dependency in this design.

## Success Criteria

1. Workstream docs distinguish source-specific run lifecycle from shared handoff / execution
   lifecycle.
2. The design defines exactly one canonical handoff model usable by both collectors.
3. The design defines object verification as durable state, not an implicit download exception.
4. The design defines execution state separately from execution result kind, avoiding mixed
   `succeeded` / `staged` / `promoted` semantics.
5. The design defines step / child-task states with retry and terminal failure semantics.
6. The design specifies how official-web app-api status columns and authenticated-notice queue
   states project from the canonical model during migration.
7. The design preserves current ownership boundaries from official-web and authenticated-notice
   architecture docs.
8. The design includes a phased implementation roadmap with verification gates before any serving
   surface opening.
9. The design can answer operator questions without reading local worker files:
   - which handoffs are verified or rejected
   - which executions are queued, running, staged, promoted, failed or dead-lettered
   - which object role failed verification
   - which step or child task blocked progress
   - whether promotion was requested, blocked, skipped or completed

## Reference Systems Used For Design

- Browsertrix: crawl workflow and crawl management separation.
- Crawlee / Scrapy: collector-internal frontier and request/result separation.
- Airbyte: source connector, sync attempt, checkpoint and state-message thinking.
- Dagster / Argo / Temporal: durable step state, artifacts, retries and asset checks.

These are design references only. This workstream does not vendor or require those runtimes.

## Canonical Entry

- `.planning/workstreams/source-handoff-ingestion-state-machine-design/README.md`
