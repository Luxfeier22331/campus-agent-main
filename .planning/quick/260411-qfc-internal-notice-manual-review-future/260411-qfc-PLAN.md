# Quick Task 260411-qfc Plan

## Goal

把 `annual_cycle_rule` 与 `time_bound_operational_rule` 的 future query contract 冻结成 repo truth，明确 reopen 前必须具备的 metadata、query mode 与 retrieval pre-filter 约束，同时保持“不新建 collection scaffold”的当前边界。

## Steps

1. 复核当前 retrieval serving / version / authz 相关 repo truth。
2. 联网确认 metadata filtering、freshness、payload filter/multitenancy 的官方约束。
3. 新增 future query contract 参考文档。
4. 同步 `docs/README`、`internal_notice` config README、实施文档与 `.planning/STATE.md`。
