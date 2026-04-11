---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-12
---

# Domains

`domains/` 提供跨文档类型的领域导航。  
它的职责是把同一领域涉及的 architecture、ADR、contract、data、plan、runbook、reference、policy 聚到一页，减少在多个目录之间来回跳。

## 当前领域 hub

- `identity-authz-memory.md`
  - canonical identity、profile/session memory、authorization truth 与 restricted rollout boundary
- `navigation.md`
  - navigation specialist、place catalog、route/wayfinding boundary 与当前 merged-truth posture
- `official-web.md`
  - `official_web` source channel、control plane、serving split 与 operator surface
- `authenticated-notice.md`
  - authenticated notice source channel、internal notice triage、promotion boundary 与 closeout/runbook
- `operator-observability.md`
  - panel observability、request projection、quality/safety/cost/audit read model、Sentry/Axiom 参与边界

## 使用规则

- 领域 hub 只做入口聚合，不替代原始 source of truth
- 长期边界仍以 architecture / decisions 为准
- 当前执行状态仍以 `.planning/PROJECT.md` 和 `.planning/STATE.md` 为准
