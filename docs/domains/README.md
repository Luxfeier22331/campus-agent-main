---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-06-11
---
# Domains

`domains/` 提供跨文档类型的领域导航。它的职责是把同一领域涉及的 architecture、ADR、contract、
data、plan、runbook、reference、policy 聚到一页，减少在多个目录之间来回跳。

## 当前领域 Hub

- `identity-authz-memory.md`
  - canonical identity、profile/session memory、authorization truth 与 restricted
    rollout boundary
- `navigation.md`
  - navigation agent、place catalog、route/wayfinding boundary 与相关执行入口
- `official-web.md`
  - `official_web` source channel、control plane、serving split 与 operator surface
- `authenticated-notice.md`
  - authenticated notice source channel、internal notice triage、promotion
    boundary 与 closeout/runbook
- `campus-services.md`
  - campus services structured runtime、projection-owned service truth
    与 opening gate
- `dining.md`
  - dining operations、食堂地图 draft/release candidate/release/published projection
    与 ops workspace
- `operator-observability.md`
  - panel observability、request projection、quality/safety/cost/audit read
    model、Sentry/Axiom 参与边界

## 使用规则

- 领域 hub 只做入口聚合，不替代原始 source of truth
- `docs/architecture/domains/` 承接 architecture-only supporting truth；这里承接跨文档类型导航
- 长期边界仍以 architecture / decisions 为准
- 通用执行态入口固定为：
  - merged truth：`../architecture/current-architecture.md`
  - repo 级当前真相：`../.planning/PROJECT.md`
  - workstream registry：`../.planning/WORKSTREAMS.md`
  - live session state：GSD SDK / Codex native session
- domain hub 可以提示 active/deferred/completed plan 的阅读顺序，但不重复维护完整
  plan 细节
- domain hub 只做 execution routing，不单独解释“当前状态”；当前真相统一回到
  `current-architecture`、`.planning/PROJECT.md`、`.planning/WORKSTREAMS.md`
  与 GSD SDK / Codex native session
- domain hub 不写带日期的 phase 进度、当前切片、blocker 列表或 milestone 级状态摘要；
  这类执行态真相只写在当前 GSD SDK / Codex session，长期结论再提升到 docs /
  ADR / runbook
- domain hub 不再把 archive/completed 材料直接挂在默认正文入口；需要追溯历史材料时，回到对应分区的
  `archive/README.md` 或 git history
