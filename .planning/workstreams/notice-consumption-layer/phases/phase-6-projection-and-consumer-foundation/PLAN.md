---
doc_type: phase_plan
phase: "6"
phase_name: "Projection And Consumer Foundation"
status: in_progress
created: 2026-04-24
updated: 2026-04-24
---

# Phase 6 Plan

## Objective

把 `notice-consumption-layer` 的第一条 implementation 真相落成代码：
建立 persisted projection store，并让 `internal_notice` 的 regulation/scoped downstream consumer 改成经由 projection 过滤 ready candidates。

## Scope

- projection shared model / store
- canonical rebuild path
- `internal_notice_restricted` 的 first implementation slice
- `institutional_rules` / `scoped_rules` consumer rewiring

## Non-goals

- runtime opening
- query-serving
- procurement / publication / roster 全量 coverage

## Exit Rule

Phase 6 完成后，repo 应满足：

1. `notice-consumption-layer` 不再只是 planning artifact。
2. `internal_notice` regulation/scoped consumer 通过 projection 读取 ready derived units。
3. 当前遗留的 implementation debt 已从 “未开始” 进入 “有代码、有持久化 metadata、有 targeted tests”。
