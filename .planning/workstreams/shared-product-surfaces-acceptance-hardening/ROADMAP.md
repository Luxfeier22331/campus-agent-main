---
doc_type: roadmap
status: completed
created: 2026-04-19
updated: 2026-04-21
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
- [x] **Phase F: Public Auth Shell Productization** — 已把 `/login` `/register` 从 out-of-scope donor wrapper 提升为正式 public auth surface，并冻结 visible owner、route contract 与 recovery CTA。
- [x] **Phase G: Password Reset Backend And Mail Contract** — 已在 `app-api` 内补齐 Better Auth reset flow，并冻结 auth mail provider / secret / callback / runbook。
- [x] **Phase H: Public Recovery UX** — 已在 `public-chat-web` 落 `/forgot-password` 与 `/reset-password`，直接消费 `Phase G` same-site reset backend，并收口 invalid / expired / success 等状态。
- [x] **Phase I: Auth Hardening And Smoke** — 已补齐 local / staging browser evidence、枚举防护、same-site origin contract 与 post-reset sign-in 闭环。
- [x] **Phase J: Adaptive Turnstile Posture Productization** — 已以真实 staging 浏览器 closeout 证明 live admitted widget 在默认 `interaction-only/render` posture 下完成 `/forgot-password -> /reset-password -> /login` 闭环，并确认匿名态 `/register` 与低风险路径无强制可见 challenge 回归。
- [x] **Phase K: Public Auth Shell Mature Layout Cutover** — 已去掉 donor auth shell 的右侧聊天窗口预览，把 `/login` `/register` `/forgot-password` `/reset-password` 收口到 repo-owned compat seam 承接的成熟单壳，并补 fresh local desktop/mobile smoke artifact。
- [x] **Phase L: Public Answer Citation Hygiene Repair** — 已修复 deterministic `rag-specialist` 用户文案把 `doc_id#chunk_id` / `source-faithful` locator 直接写进答案的问题，并在 `app-api` finalize 边界补齐 browser-facing answer hygiene guard 与回归测试。
- [x] **Phase M: Curriculum Semester Answer Boundary Repair** — 已修复 `program_semester_facts` 多 chunk 命中时把 chunk 边界残片直接拼进课程答案的问题；`rag-specialist` 现按学期课程事实做 deterministic 合并，local direct execution 与 `public-chat-web` 真实 smoke 都已证明不再出现断裂课程名。
