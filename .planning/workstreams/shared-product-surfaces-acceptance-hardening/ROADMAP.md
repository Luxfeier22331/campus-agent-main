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
- [ ] **Phase D: Integrated Acceptance** — 验证 public chat request 到 panel `Requests` projection 的同链路消费。
- [ ] **Phase E: Staging Preflight And Planning Closeout** — 在 integrated acceptance 后执行 staging preflight 与 planning truth closeout。
