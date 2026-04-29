---
doc_type: plan
status: completed
created: 2026-04-05
updated: 2026-04-20
---

# Campus Place Finding Foundation

## Completion Note

这条 place-finding foundation 已关闭。
它完成的是 Wave E 早期导航 foundation 的实施 handoff；当前导航前向恢复已经转向新的 rollout / map consumption 入口。

## What This Plan Closed

- 固定 `place_lookup` / `place_finding` 首发边界
- 固定地点实体、place catalog 与非 route-planning 的最小回答闭环
- 证明首轮导航 foundation 不再需要保留为 active plan

## Current Canonical Entry

- `docs/domains/navigation.md`
- `docs/architecture/navigation-and-wayfinding-architecture.md`
- `docs/decisions/adr-0027-navigation-agent-and-spatial-truth.md`
- `docs/plans/archive/historical/campus-navigation-rollout-map-consumption.md`
- `.planning/WORKSTREAMS.md`

## Reopen Rule

后续若继续推进地图消费、route/wayfinding 或 place-card rollout，应在当前 backlog / workstream registry 上继续，不再回到这份 foundation 文档展开执行细节。
