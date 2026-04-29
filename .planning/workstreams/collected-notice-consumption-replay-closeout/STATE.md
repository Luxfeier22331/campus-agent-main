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
- current phase: `Phase 3`
- current slice: reset implementation, dry-run report, backup, execute, and post-reset audit
- last activity: 2026-04-29
- last activity description: Phase 2 completed chain contract, consumer admission schema, searchable notice schema, downstream batching policy, dry-run report contract, and admission fixture. Phase 3 can now implement reset dry-run / backup / execute against the captured-but-not-imported boundary.

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
- [x] Froze captured -> source-truth -> searchable -> admission -> downstream chain contract.
- [x] Froze consumer admission schema and fixture covering all consumption classes.
- [x] Froze searchable notice layer schema.
- [x] Froze downstream batching policy for `regulation`, `transport_schedule`, and `service_status`.
- [x] Froze dry-run no-write report contract.

## Current Phase Tasks

- [ ] Implement or identify reset dry-run command and output report.
- [ ] Produce reset backup artifact before write mode.
- [ ] Execute reset to captured-but-not-imported boundary.
- [ ] Apply source-lineage `service_guide` cleanup and stable-row preservation.
- [ ] Produce post-reset audit proving captured objects and run ledger remain intact.

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
- `phases/phase-02-chain-contract-and-admission-design/SUMMARY.md`
- `phases/phase-03-reset-derived-state-to-collected-only/PLAN.md`
- `evidence/phase-01-current-state-audit-and-reset-manifest/reset-manifest.dry-run.json`

Phase 2 has resolved the reset boundary and admission contract. Phase 3 may implement reset dry-run and backup first; do not run execute mode until the dry-run report and backup artifact are present.
