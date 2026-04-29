---
doc_type: roadmap
status: deferred
created: 2026-04-19
updated: 2026-04-27
---

# Roadmap: Restricted Document Surface Rollout Verification

## Overview

这条 workstream 当前为 deferred。
恢复时固定顺序如下：

- [ ] **Phase A: Restricted Surface Opening Admission**
- [ ] **Phase B: Principal / Entitlement Projection And Release Posture**
- [ ] **Phase C: Restricted Reader / Query / Download Surface Rollout**
- [ ] **Phase D: Allow-deny Matrix And Leakage-hardening Evidence**
- [ ] **Phase E: Planning Closeout**

## Guardrails

- 不重开 identity / authz foundation；canonical authz truth 继续属于 `app-api`
- 不把 `internal_notice` 离线 preparation 当作已开放 restricted surface
- 不把 public docs reader、notice-derived regulation materialization 或 source-triage recovery
  混入本条线
- restricted retrieval 必须 candidate-pre-filter + fail-close，不接受回答层后置裁剪
