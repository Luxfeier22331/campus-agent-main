---
doc_type: roadmap
status: active
created: 2026-04-19
updated: 2026-04-25
---

# Roadmap: Authenticated Notice Live Portal Control Plane

## Overview

这条 workstream 当前已恢复到 active。2026-04-25 已完成 auth-readiness refresh、proxy
fallback、live notice export、HTML inline-image capture fix、legacy `.doc` import admission
fix，以及 refreshed 60-notice source-truth inventory sync。
继续执行时固定顺序如下：

- [x] **Phase A: Collector Runtime / Repo Migration Truth Refresh**
- [ ] **Phase B: Auth Bootstrap / Live Capture Policy / Scheduling**
- [ ] **Phase C: Run Ledger / Artifact Refs / Auth Readiness** — 补齐 run ledger / artifact refs，并保留 attachment presence signals；正文内联图片已进入 captured attachment ref/entity。
- [ ] **Phase D: Live-Historical Reconcile** — 对齐 live capture 与 historical bootstrap import，在 notice 正文声明附件但 payload 未返回附件实体时保留 fail-close mismatch truth，而不是静默写成“无附件”。
- [ ] **Phase E: Operator Control Plane / Bounded Source-channel APIs**
- [ ] **Phase F: Planning Closeout**
