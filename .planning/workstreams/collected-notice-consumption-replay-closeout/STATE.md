---
doc_type: state
status: active
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# State: Collected Notice Consumption Replay Closeout

## Current Position

- status: `active`
- current phase: `Phase 2`
- current slice: chain contract and admission design
- last activity: 2026-04-29
- last activity description: Phase 1 read-only audit completed. Evidence now records captured run inventory, source-truth inventory, derived/downstream state, dry-run reset manifest, and backup plan. Phase 2 must resolve the source-truth reset boundary and mixed service-guide current release boundary before reset execution.

## Why This Workstream Exists

当前已有采集对象、source-truth inventory 与部分下游试验数据，但状态混合：

- object-native handoff 已基本完成，但不等于所有采集通知已经被正确消费。
- `internal_notice_read_model` 当前为 `0`，因此全量可检索层尚未落地。
- `notice_consumption_projection`、schedule OCR、typed service-status/service-guide/transport release 已有旧数据，但混合了 smoke、stage、manual-review、current 和 partial replay。
- WeChat 与 file_release/regulation 的首期消费边界需要在重新导入前统一。

本线目标是恢复干净基线，并用 dry-run + manifest 重新导入与消费当前已采集内容。

## Completed Tasks

- [x] Created native workstream directory.
- [x] Defined target shape and scope.
- [x] Split roadmap into 7 phases.
- [x] Recorded current local PG baseline from read-only audit.
- [x] Produced Phase 1 captured run inventory.
- [x] Produced Phase 1 source-truth inventory audit.
- [x] Produced Phase 1 derived/downstream state inventory.
- [x] Produced Phase 1 reset dry-run manifest.
- [x] Produced Phase 1 reset backup plan.
- [x] Decided Phase 3 reset should clear source-truth / holding / registry import rows to return to captured-but-not-imported.
- [x] Decided mixed `service_guide` cleanup should be source-lineage based and preserve stable PDF/handbook/campus-card rows.

## Current Phase Tasks

- [ ] Freeze chain contract for captured -> source-truth -> searchable -> downstream replay.
- [x] Decide whether Phase 3 reset clears source-truth / holding rows or only derived consumption rows.
- [x] Decide how to handle mixed `service_guide` current release before reset.
- [ ] Freeze consumer admission schema.
- [ ] Freeze searchable notice layer schema.
- [ ] Freeze downstream batching policy for regulation / transport_schedule / service_status.

## Known Non-Overlap

- 定时调度与认证续期不属于本线。
- collector acquisition provider 不属于本线。
- object-native collector-worker handoff closeout 不属于本线，除非 reset/replay 发现 handoff evidence drift。
- existing `notice-consumption-layer` schema 不在本线随意重写；本线只在首期 replay contract 中消费它。

## Blockers

- none

## Verification Plan

Planning-only start:

```bash
pnpm docs:lint
```

Implementation phases will add focused Python and worker tests once reset / replay commands are introduced.

## Resume Notes

Start with:

- `README.md`
- `REQUIREMENTS.md`
- `ROADMAP.md`
- `phases/phase-02-chain-contract-and-admission-design/PLAN.md`
- `evidence/phase-01-current-state-audit-and-reset-manifest/reset-manifest.dry-run.json`

Do not run reset or purge commands before Phase 2 resolves the manual confirmation groups in the Phase 1 reset manifest.
