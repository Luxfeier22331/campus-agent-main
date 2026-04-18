---
doc_type: plan
status: deferred
created: 2026-04-18
updated: 2026-04-18
---

# Campus Navigation Rollout And Map Consumption

## 文档边界

本文固定 `campus navigation rollout / place_card / map consumption` 这条单一 workstream 的前向范围：

- 校园地图实际上线后的 `place_lookup` 产品路径恢复
- chat 内 `place_card` 与 map-enhanced consumption
- 同一产品 surface 内的地图消费与前向验收
- staging/manual acceptance 与 planning closeout

本文不负责：

- 重写 `docs/architecture/navigation-and-wayfinding-architecture.md` 已冻结的长期导航边界
- 重新打开 `route_planning`、`entrance_selection`、`accessibility_routing`
- 把 `place_catalog` foundation 重写成新的 source/data-plane phase
- 把 `navigation-specialist`、map UI、staging/manual acceptance 拆成多条并发 workstream

## 当前生命周期状态

- 当前状态是 `deferred`
- planning 状态对应 `.planning/WORKSTREAMS.md` 中的 backlog 条目；当前不预建 native workstream 目录
- 当前只是明确恢复入口，不表示导航已经重新进入 active execution
- 只有在校园地图实际上线后，这条线才恢复
- 恢复后仍保持单一 workstream；并行只允许发生在与它无共享写集的其他 workstreams 之间

## 直接结论

导航恢复不应拆成多条并发 workstream。

它必须作为一条 `campus navigation rollout / place_card / map consumption` workstream 推进，固定顺序如下：

1. map-launch preconditions and reopen truth
2. `place_lookup` runtime recovery
3. `place_card` and map consumption
4. staging/manual acceptance
5. planning closeout

原因固定为：

- `place_lookup`、`place_card` 与地图消费共享同一条 `app-api -> supervisor-api -> supervisor-core -> navigation-specialist` 产品路径
- 地图视图在长期形态里只是 chat answer 的增强表达层，不是独立产品真相
- 如果把 specialist runtime、map UI、staging acceptance 拆 lane，容易在地图尚未真正上线或 runtime 仍 fail-close 时提前堆消费层补丁
- 当前已完成的 foundation 是 repo-internal 能力，不等于产品已 reopened；恢复必须把 runtime、消费层与验收证据放在同一条线上收口

## 前置真相

接手这条线之前，先以以下文档为准：

- `docs/architecture/navigation-and-wayfinding-architecture.md`
- `docs/decisions/adr-0027-navigation-specialist-and-spatial-truth.md`
- `docs/decisions/adr-0028-campus-navigation-basemap-and-provider-strategy.md`
- `docs/plans/campus-place-finding-foundation.md`
- `.planning/PROJECT.md`
- `.planning/WORKSTREAMS.md`

## 固定执行规则

- 地图实际上线前，继续保持当前 supervisor 产品路径对 `place_lookup` fail-close
- 恢复导航产品路径，不等于同时打开 `route_planning`、路线交互或更广的 wayfinding scope
- `place_catalog` 与 `navigation-specialist` 继续是 canonical place truth 与 capability owner；地图 renderer / SDK 仍只是 presentation layer
- 如果问题根因落在 `navigation-specialist`、`app-api` typed projection 或 `structuredParts` contract，修复必须回到这些边界，不在前端 map 层堆补丁
- `place_lookup` runtime、`place_card`、map consumption、staging/manual acceptance 都只作为这条单一 workstream 的顺序子层推进，不再平行拆 lane

## Phase A: Map-Launch Preconditions And Reopen Truth

目标：

- 在真正恢复执行前，确认校园地图已经进入可消费的产品状态
- 把本轮恢复的能力边界重新写死为 `place_lookup + place_card + map consumption`

退出条件：

- 地图上线前提已成立，不再只是 repo 内部 foundation 或占位 UI
- 本轮 scope 明确仍不包含 `route_planning`
- reopening 的产品范围、消费面和 acceptance 口径已写明

## Phase B: `place_lookup` Runtime Recovery

目标：

- 恢复 `place_lookup` 在当前产品路径上的运行时能力
- 确保 `app-api -> supervisor -> navigation-specialist` 仍按当前 typed seam 工作，而不是回退成文档 RAG 猜测

退出条件：

- 当前产品路径不再对 `place_lookup` fail-close
- 高歧义地点继续 `needs_clarification`，而不是 top1 猜测
- `place_catalog` truth、alias resolution 与 answer shaping 不因恢复产品面而漂移

## Phase C: `place_card` And Map Consumption

目标：

- 把已有的 place truth 恢复为真实用户可消费的 `place_card` 与地图增强视图
- 保持 `chat-first, map-enhanced, full-map-optional` 的长期交互姿态

退出条件：

- `place_card` 可稳定消费 canonical place truth
- 地图消费层只作为 answer enhancement，不绕开 shared execution / request correlation path
- point/map view 与文本答案之间不存在双真相

## Phase D: Staging And Manual Acceptance

目标：

- 在运行时恢复和消费层恢复之后，完成真实 staging smoke 与人工验收

退出条件：

- staging 上的导航产品路径已完成 smoke
- 人工验收已覆盖 `place_lookup`、`place_card` 和地图消费的关键路径
- 不把本地 seed truth 或局部 UI 可见性误写成产品已完成 reopen

## Phase E: Planning Closeout

目标：

- 把导航恢复后的当前真相、剩余后置项与后续路线继续写回 planning

退出条件：

- `.planning/PROJECT.md`、`.planning/WORKSTREAMS.md` 与相关 reference 文档已更新
- 已明确记录哪些导航能力已经 reopened，哪些仍继续 deferred
- 不把这条恢复 workstream 与未来的 `route_planning` phase 混写

## 接手标准

其他会话接手这条线时，默认按以下顺序开始：

1. 先检查 `.planning/WORKSTREAMS.md`，确认这条线是否仍处于 backlog，还是已经被显式恢复
2. 如果刚恢复执行，不要直接从地图 UI 开始；先核对 map-launch precondition 与 `place_lookup` 当前 runtime truth
3. 完成后再更新 `.planning/PROJECT.md`、`.planning/WORKSTREAMS.md` 与相关 evidence 文档
