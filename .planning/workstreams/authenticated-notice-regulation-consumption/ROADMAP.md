---
doc_type: roadmap
status: completed
created: 2026-04-19
updated: 2026-04-24
---

# Roadmap: Authenticated Notice Regulation Consumption

## Overview

这条 workstream 只收口已捕获 authenticated-notice corpus 的 regulation downstream consumption。
固定顺序来自 `.planning/workstreams/authenticated-notice-regulation-consumption/README.md` 与本 workstream phase 目录，
不再拆成 replay / promotion / quality 多条并发 lane。
当前已完成 `11-target rerun -> evidence freeze`，workstream 停在 `offline_preparation`。

## Phases

- [x] **Phase 1: Source Current Scope And Admitted Inventory** — 稳住 `internal_notice` source current scope 与 admitted regulation inventory。
- [x] **Phase 2: Promotion Routing** — 稳定 `candidate / hold / manual_review_required` routing truth。
- [x] **Phase 3: Local-only Candidate Artifacts** — 导出 bounded candidate artifacts，供 target-side materialization 消费。
- [x] **Phase 4: Target Materialization** — materialize 到 `regulations/institutional_rules` / `regulations/scoped_rules`。
- [x] **Phase 5: Target-side Chunk And Quality Acceptance** — 作为 target-side quality umbrella 已完成规划收口，并显式拆成 `Phase 6-8` 三个 execution-ready slices。
- [x] **Phase 6: Institutional Regulations Target Chunk-Prep Parity** — 已补齐 `regulations/institutional_rules` 的 collection-specific lane profile/runtime wiring，并与既有 `scoped_rules` acceptance seam 对齐。
- [x] **Phase 7: Eleven-Target Acceptance Rerun And Gap Closure** — 已完成当前 `11` 条 admitted target 的 full local-only acceptance rerun；最终 `institutional_rules=2`、`scoped_rules=9`，两条 lane 均通过 fail-close 验收。
- [x] **Phase 8: Acceptance Evidence Freeze And Closeout** — 已冻结 `chunk-prep-manifest.json` / `validation-summary.json` / `document-reports.jsonl`，补齐 runbook / reference continuity，并把 stop point 保持在 `offline_preparation`。
