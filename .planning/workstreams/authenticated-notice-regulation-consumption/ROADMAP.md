---
doc_type: roadmap
status: active
created: 2026-04-19
updated: 2026-04-30
---

# Roadmap: Authenticated Notice Regulation Consumption

## Overview

这条 workstream 只收口已捕获 authenticated-notice corpus 的 regulation downstream consumption。
固定顺序来自 `.planning/workstreams/authenticated-notice-regulation-consumption/README.md` 与本 workstream phase 目录，
不再拆成 replay / promotion / quality 多条并发 lane。
当前已完成 `11-target rerun -> evidence freeze`，并在 2026-04-30 为
collected-notice Phase 6R/7 验证出的 `8` 条 regulation candidates 重开
Phase 9。Phase 9 只推进 selected first-batch target materialization /
offline reader preparation，不打开 query serving 或 RAG release。

## Phases

- [x] **Phase 1: Source Current Scope And Admitted Inventory** — 稳住 `internal_notice` source current scope 与 admitted regulation inventory。
- [x] **Phase 2: Promotion Routing** — 稳定 `candidate / hold / manual_review_required` routing truth。
- [x] **Phase 3: Local-only Candidate Artifacts** — 导出 bounded candidate artifacts，供 target-side materialization 消费。
- [x] **Phase 4: Target Materialization** — materialize 到 `regulations/institutional_rules` / `regulations/scoped_rules`。
- [x] **Phase 5: Target-side Chunk And Quality Acceptance** — 作为 target-side quality umbrella 已完成规划收口，并显式拆成 `Phase 6-8` 三个 execution-ready slices。
- [x] **Phase 6: Institutional Regulations Target Chunk-Prep Parity** — 已补齐 `regulations/institutional_rules` 的 collection-specific lane profile/runtime wiring，并与既有 `scoped_rules` acceptance seam 对齐。
- [x] **Phase 7: Eleven-Target Acceptance Rerun And Gap Closure** — 已完成当前 `11` 条 admitted target 的 full local-only acceptance rerun；最终 `institutional_rules=2`、`scoped_rules=9`，两条 lane 均通过 fail-close 验收。
- [x] **Phase 8: Acceptance Evidence Freeze And Closeout** — 已冻结 `chunk-prep-manifest.json` / `validation-summary.json` / `document-reports.jsonl`，补齐 runbook / reference continuity，并把 stop point 保持在 `offline_preparation`。
- [ ] **Phase 9: First-Batch Regulation Promotion Write Gate** — 对 collected-notice Phase 6R/7 已证明 ready 的 `8` 条 regulation candidates 建立 selected promotion write gate，执行 target materialization / offline reader preparation，并证明 query serving 与 RAG release 仍关闭。

## Phase 9: First-Batch Regulation Promotion Write Gate

**Goal:** 把已 dry-run 证明 ready 的 `8` 条 selected regulation candidates
推进到真实 target materialization，同时保留既有 target rows，并保持
query-serving / RAG release 关闭。

**Inputs:**

- collected-notice Phase 6R.1 candidate audit
- collected-notice Phase 6R.3 normalized dry-run materialization
- collected-notice Phase 6R.3 consistency report
- collected-notice Phase 7 acceptance summary

**Selected cohort:**

- `594` -> `regulations/institutional_rules`
- `483`, `485`, `487`, `493`, `509`, `564`, `620` ->
  `regulations/scoped_rules`

**Deliverables:**

- first-batch selected admission artifact
- selected promotion preflight report
- selected target materialization execute report
- before/after target registry snapshot
- source-to-target provenance trace
- target-side acceptance artifacts for institutional/scoped lanes
- serving-closed assertion

**Plan:** `phases/phase-09-first-batch-regulation-promotion-write-gate/PLAN.md`
