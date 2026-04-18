---
doc_type: roadmap
status: active
created: 2026-04-19
updated: 2026-04-19
---

# Roadmap: Shared Product Surfaces Acceptance Hardening

## Overview

这条 workstream 覆盖 `apps/app-api`、`apps/public-chat-web`、`apps/protected-panel-web` 的联合验收。
同一 workstream 内禁止并发拆分 chat / panel / backend。

## Phases

- [x] **Phase A: App API Acceptance Baseline** — local shared DB bootstrap、Node lane、Worker lane 与 shared DB integration lane 已 fresh 通过。
- [x] **Phase B: Public Chat Web Acceptance** — type/test/build 基线已 fresh 通过，当前等待 browser smoke 纳入 integrated acceptance。
- [x] **Phase C: Protected Panel Web Acceptance** — type/test/build 基线已 fresh 通过，当前等待 integrated acceptance。
- [x] **Phase D: Integrated Acceptance** — 已以 local public chat browser smoke、同链路 `requestId` projection 与 staging panel `Requests` consumption evidence 证明 integrated path 成立。
- [x] **Phase E: Staging Preflight And Planning Closeout** — 已修复 dev-backed supervisor upstream、收口 staging `app-api /readyz` 与三端 preflight，并将 continuity 挂回 workstream-native planning truth。
- [ ] **Phase F: Public Auth Shell Productization** — 把 `/login` `/register` 从 out-of-scope donor wrapper 提升为正式 public auth surface，并冻结 visible owner、route contract 与 recovery CTA。
- [ ] **Phase G: Password Reset Backend And Mail Contract** — 在 `app-api` 内补齐 Better Auth reset flow，并冻结 auth mail provider / secret / callback / runbook。
- [ ] **Phase H: Public Recovery UX** — 在 `public-chat-web` 落 `/forgot-password` 与 `/reset-password`，收口 invalid / expired / success 等状态。
- [ ] **Phase I: Auth Hardening And Smoke** — 补齐 local / staging browser evidence、枚举防护、same-site origin contract 与 post-reset sign-in 闭环。
