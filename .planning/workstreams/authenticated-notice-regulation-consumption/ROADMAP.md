---
doc_type: roadmap
status: active
created: 2026-04-19
updated: 2026-04-19
---

# Roadmap: Authenticated Notice Regulation Consumption

## Overview

这条 workstream 只收口已捕获 authenticated-notice corpus 的 regulation downstream consumption。
固定顺序来自 `docs/plans/internal-notice-policy-regulation-consumption-implementation.md`，不再拆成 replay / promotion / quality 多条并发 lane。

## Phases

- [x] **Phase A: Source Current Scope And Admitted Inventory** — 稳住 `internal_notice` source current scope 与 admitted regulation inventory。
- [x] **Phase B: Promotion Routing** — 稳定 `candidate / hold / manual_review_required` routing truth。
- [x] **Phase C: Local-only Candidate Artifacts** — 导出 bounded candidate artifacts，供 target-side materialization 消费。
- [x] **Phase D: Target Materialization** — materialize 到 `regulations/institutional_regulations` / `regulations/scoped_rules`。
- [ ] **Phase E: Target-side Chunk And Quality Acceptance** — 固化 target-side chunk prep、metadata 与 quality acceptance。
