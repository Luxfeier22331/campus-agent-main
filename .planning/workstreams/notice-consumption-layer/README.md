---
doc_type: index
status: active
created: 2026-04-22
updated: 2026-04-24
---

# Workstream: Notice Consumption Layer

这是 `notice-consumption-layer` 的本地 workstream 入口。
这条线的 `Phase 1-5` 已完成 semantic modeling closeout，但 “implementation 应完全回到 adoption target、因此本线可关闭” 这一判断已被证实过早。
当前这条 workstream 已重开为 active implementation lane，负责把 repo-owned notice consumption projection 真正落成代码与持久化 metadata truth。

## Current Status

- status: `active`
- current phase: `Phase 6`
- current focus:
  - 补 `source_notice -> derived consumption unit` 的持久化 projection store
  - 让 `internal_notice` 的 regulation / scoped downstream consumer 经由 projection 过滤，而不是继续直接扫 source holding collection
  - 保留 `Phase 1-5` 的 modeling truth，不重开 source family / schema / authority 基线

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Archived Snapshot

- 2026-04-22 semantic-modeling closeout snapshot: `../../../docs/plans/archive/completed/notice-consumption-layer.md`
