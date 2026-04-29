# Quick Task 260411-sru Plan

## Goal

把 `annual_cycle_rule` 与 `time_bound_operational_rule` 的当前策略从“继续停在 manual-review”切到“进入统一 `regulations/scoped_rules` holding collection”，并保持 `offline_preparation + query_disabled`。

## Steps

1. 复核当前 `internal_notice -> regulations/*` 边界与现有 scaffold。
2. 联网确认 metadata/payload/collection 粒度的官方依据。
3. 新增 ADR 与 `scoped_rules` config scaffold。
4. 同步 current architecture、manual-review docs 和 `.planning/STATE.md`。
