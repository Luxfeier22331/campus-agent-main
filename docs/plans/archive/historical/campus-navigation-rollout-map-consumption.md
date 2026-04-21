---
doc_type: plan
status: historical
created: 2026-04-18
updated: 2026-04-22
---

# Campus Navigation Rollout And Map Consumption

## 文档边界

本文固定 `campus navigation rollout / place_card / map consumption` 这条 backlog workstream 的前向范围。

它负责：

- 校园地图实际上线后的 `place_lookup` 产品路径恢复
- chat 内 `place_card` 与 map-enhanced consumption
- staging/manual acceptance 与 planning closeout

它不负责：

- 重开 `route_planning`、`entrance_selection`、`accessibility_routing`
- 把 `place_catalog` foundation 改写成新的 source/data-plane lane
- 把导航 specialist、地图 UI 与验收拆成多条并发 workstream

## Lifecycle Contract

- 文档 lifecycle 保持 `deferred`
- repo 级 registry state 目前对应 backlog；是否恢复执行只看 `.planning/WORKSTREAMS.md`
- 本文只保留固定 phase order、reopen precondition 与排除项

## Current Baseline

当前 merged truth 已固定的前提：

- `campus place-finding foundation` 已关闭，基础 place truth 仍保留
- 地图实际上线前，`place_lookup` 产品路径继续 fail-close
- 地图消费层仍只是 answer enhancement，不是独立 place truth owner
- `route_planning` 继续不在当前 accepted scope 内

## Execution Contract

导航恢复始终按一条单独 workstream 推进：

1. map-launch preconditions
2. `place_lookup` runtime recovery
3. `place_card` and map consumption
4. staging/manual acceptance
5. planning closeout

固定原因：

- `place_lookup`、`place_card` 与地图消费共享同一条 `app-api -> supervisor-api -> navigation-specialist` 产品路径
- 若拆 lane，容易在地图尚未真正上线或 runtime 仍 fail-close 时提前堆消费层补丁

## Fixed Rules

- 地图实际上线前，继续保持 `place_lookup` fail-close
- 恢复导航产品路径，不等于同时打开 `route_planning`
- `place_catalog` 与 `navigation-specialist` 继续是 canonical truth owner
- 如果问题根因落在 typed seam、specialist 或 answer shaping，修复必须回到这些边界

## Forward Phases

### Phase A: Map-Launch Preconditions

目标：

- 明确地图已经进入可消费产品状态

### Phase B: `place_lookup` Runtime Recovery

目标：

- 恢复 `place_lookup` 在线产品路径

### Phase C: `place_card` And Map Consumption

目标：

- 把 canonical place truth 恢复为真实用户可消费的 `place_card` 与地图增强视图

### Phase D: Staging And Manual Acceptance

目标：

- 完成导航产品路径的真实 smoke 与人工验收

### Phase E: Planning Closeout

目标：

- 把 reopened 能力与剩余 deferred item 写回 planning

## Exclusions

固定不包含：

- route planning
- 地图 provider / basemap strategy 重审
- repo-wide navigation data-plane 重构

## Handoff Rule

后续接手时：

1. 先看 `.planning/WORKSTREAMS.md`
2. 再看导航相关 architecture / ADR
3. 最后回到本文确认 reopen precondition 与顺序
