---
doc_type: plan
status: completed
created: 2026-03-28
updated: 2026-04-20
---

# Intent / Memory / Authorization Foundation

## Completion Note

这条 identity / memory / authz foundation 已关闭。
它负责的 owner split、projection boundary 与 non-authorizing memory baseline 已进入 repo truth；当前不再作为默认实施入口。

## What This Plan Closed

- 固定 intent / memory / authorization 的长期边界
- 固定 app-layer identity / memory ownership 与 retrieval filter projection posture
- 明确 foundation 已完成，后续 memory productization 必须以新 lane 继续

## Current Canonical Entry

- `docs/domains/identity-authz-memory.md`
- `docs/architecture/identity-and-authorization-architecture.md`
- `docs/architecture/product-runtime-architecture.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `docs/decisions/adr-0034-authorization-model-and-retrieval-filter-projection.md`

## Reopen Rule

后续若继续推进 memory productization、long-term memory 或更复杂 authorization workflow，应新开 follow-up lane，不再沿用这份 foundation 计划。
