---
doc_type: roadmap
status: active-blocked
created: 2026-04-19
updated: 2026-04-25
---

# Roadmap: Authenticated Notice Live Portal Control Plane

## Overview

这条 workstream 当前已恢复到 auth-readiness 收口，但被当前候选 `SSO_TGC` 返回
`auth-expired: session invalid` 阻塞。
继续执行时固定顺序如下：

- [ ] **Phase A: Collector Runtime / Repo Migration Truth Refresh**
- [ ] **Phase B: Auth Bootstrap / Live Capture Policy / Scheduling**
- [ ] **Phase C: Run Ledger / Artifact Refs / Auth Readiness** — 补齐 attachment presence signals，显式区分 `body-declared attachment`、`captured attachment ref/entity` 与 declared-but-unmaterialized mismatch。
- [ ] **Phase D: Live-Historical Reconcile** — 对齐 live capture 与 historical bootstrap import，在 notice 正文声明附件但 payload 未返回附件实体时保留 fail-close mismatch truth，而不是静默写成“无附件”。
- [ ] **Phase E: Operator Control Plane / Bounded Source-channel APIs**
- [ ] **Phase F: Planning Closeout**
