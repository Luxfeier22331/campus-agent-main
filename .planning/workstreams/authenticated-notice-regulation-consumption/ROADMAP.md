---
doc_type: roadmap
status: deferred
created: 2026-04-19
updated: 2026-04-20
---

# Roadmap: Authenticated Notice Regulation Consumption

## Overview

这条 workstream 只收口已捕获 authenticated-notice corpus 的 regulation downstream consumption。
固定顺序来自 `docs/plans/internal-notice-policy-regulation-consumption-implementation.md`，不再拆成 replay / promotion / quality 多条并发 lane。

## Phases

- [x] **Phase 1: Source Current Scope And Admitted Inventory** — 稳住 `internal_notice` source current scope 与 admitted regulation inventory。
- [x] **Phase 2: Promotion Routing** — 稳定 `candidate / hold / manual_review_required` routing truth。
- [x] **Phase 3: Local-only Candidate Artifacts** — 导出 bounded candidate artifacts，供 target-side materialization 消费。
- [x] **Phase 4: Target Materialization** — materialize 到 `regulations/institutional_regulations` / `regulations/scoped_rules`。
- [ ] **Phase 5: Target-side Chunk And Quality Acceptance** — 固化 target-side chunk prep、metadata 与 quality acceptance。
- [ ] **Phase 6: Institutional Regulations Target Chunk-Prep Parity** — 补齐 `regulations/institutional_regulations` 的 repo-native target-side chunk-prep / validation lane，使其与既有 `scoped_rules` acceptance seam 对齐。
- [ ] **Phase 7: Eleven-Target Acceptance Rerun And Gap Closure** — 对当前 `11` 条 admitted target 执行 full local-only acceptance rerun，并收口 title / contextualization / identity metadata / semantic-owner lineage / wrapper leak / front matter leak 等 fail-close 问题。
- [ ] **Phase 8: Acceptance Evidence Freeze And Closeout** — 冻结 `chunk-prep-manifest.json` / `validation-summary.json` / `document-reports.jsonl`、补齐 runbook / reference continuity，并把 stop point 保持在 `offline_preparation`。
