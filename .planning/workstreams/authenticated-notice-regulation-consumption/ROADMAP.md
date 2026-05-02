---
doc_type: roadmap
status: completed
created: 2026-04-19
updated: 2026-05-02
---

# Roadmap: Authenticated Notice Regulation Consumption

## Overview

这条 workstream 只收口已捕获 authenticated-notice corpus 的 regulation downstream consumption。
固定顺序来自 `.planning/workstreams/authenticated-notice-regulation-consumption/README.md` 与本 workstream phase 目录，
不再拆成 replay / promotion / quality 多条并发 lane。
当前已完成 `11-target rerun -> evidence freeze`、2026-04-30 first-batch
selected regulation promotion、Phase 10 regulation serving admission 与 Phase 11
manual-review second-batch selected materialization。Phase 10
把已 materialized 的 `8` 条 selected targets 推进到 provenance-hardened、
chunk-prepared、Qdrant released、gated-reader-ready 状态；`institutional_rules`
进入默认 query-serving allowlist，`scoped_rules` 保持 explicit/internal only。
Phase 11 将 `481` / `619` 写入 target materialization，但不打开 RAG release。
本轮 hardening 已补齐 regulation canonical cleaning v2 边界：清洗在 target
materialization 入库前完成，RAG release 只校验并消费 canonical artifacts。
Phase 13 已补齐历史 selected regulation backfill 入口：Phase 9/11 既有历史
cohort 可统一从 source owner text 重建 v2 canonical artifacts，再交给独立 RAG
release lane。

## Phases

- [x] **Phase 1: Source Current Scope And Admitted Inventory** — 稳住 `internal_notice` source current scope 与 admitted regulation inventory。
- [x] **Phase 2: Promotion Routing** — 稳定 `candidate / hold / manual_review_required` routing truth。
- [x] **Phase 3: Local-only Candidate Artifacts** — 导出 bounded candidate artifacts，供 target-side materialization 消费。
- [x] **Phase 4: Target Materialization** — materialize 到 `regulations/institutional_rules` / `regulations/scoped_rules`。
- [x] **Phase 5: Target-side Chunk And Quality Acceptance** — 作为 target-side quality umbrella 已完成规划收口，并显式拆成 `Phase 6-8` 三个 execution-ready slices。
- [x] **Phase 6: Institutional Regulations Target Chunk-Prep Parity** — 已补齐 `regulations/institutional_rules` 的 collection-specific lane profile/runtime wiring，并与既有 `scoped_rules` acceptance seam 对齐。
- [x] **Phase 7: Eleven-Target Acceptance Rerun And Gap Closure** — 已完成当前 `11` 条 admitted target 的 full local-only acceptance rerun；最终 `institutional_rules=2`、`scoped_rules=9`，两条 lane 均通过 fail-close 验收。
- [x] **Phase 8: Acceptance Evidence Freeze And Closeout** — 已冻结 `chunk-prep-manifest.json` / `validation-summary.json` / `document-reports.jsonl`，补齐 runbook / reference continuity，并把 stop point 保持在 `offline_preparation`。
- [x] **Phase 9: First-Batch Regulation Promotion Write Gate** — 对 collected-notice Phase 6R/7 已证明 ready 的 `8` 条 regulation candidates 建立 selected promotion write gate，执行 target materialization / offline reader preparation，并证明 query serving 与 RAG release 仍关闭。
- [x] **Phase 10: Regulation Serving Admission** — 对 first-batch regulation targets 执行 provenance hardening、chunk preparation、Qdrant release alias、gated reader asset publish、retrieval smoke 与 admission guard 更新；保持 public-chat citation 关闭。
- [x] **Phase 11: Second-Batch Manual-Review Admission** — 对已 owner-text ready 且显式人工 resolution 的 `481` / `619` 建立 selected materialization gate；写入 target artifacts，并证明 serving / RAG release 仍关闭。
- [x] **Phase 12: Regulation Canonical Cleaning Hardening** — 将 regulation wrapper/page artifact/soft-wrap/readable punctuation 清洗前移并固化在 target materialization；selected execute 拒绝非 passed quality，RAG preparation 缺清洗 provenance 时 fail closed。
- [x] **Phase 13: Historical Regulation Canonical Backfill** — 为 Phase 9/11 已采集 selected regulation cohort 增加 canonical backfill 路径，从 admission/source owner text 重建 v2 canonical artifacts，保持 query serving / RAG release 关闭。

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

**Result:**

- materialized document count: `8`
- postflight target counts:
  - `regulations/institutional_rules=2`
  - `regulations/scoped_rules=16`
- selected acceptance:
  - institutional lane: `passed=true`, prepared documents `1`
  - scoped lane: `passed=true`, prepared documents `7`
- query serving / RAG release: closed

**Plan:** `phases/phase-09-first-batch-regulation-promotion-write-gate/PLAN.md`
**Summary:** `phases/phase-09-first-batch-regulation-promotion-write-gate/SUMMARY.md`

## Phase 10: Regulation Serving Admission

**Goal:** 将 Phase 9 已入库的 `8` 条 regulation target 从 materialized
状态推进到受控 serving 状态，同时保持 public-chat citation 关闭。

**Deliverables:**

- registry provenance hardening：`manual_curated` residual 收敛到
  `authenticated_notice_portal`
- runtime/query-serving profile admission：
  - `regulations/institutional_rules`: `query_enabled_by_default=true`
  - `regulations/scoped_rules`: `retrieval_enabled=true`，但
    `query_enabled_by_default=false`
- mandatory chunk-preparation artifacts
- Qdrant release aliases for both target collections
- gated reader assets，`public_entry_count=0`
- retrieval smoke with campus-member authorization and public-filter denial
- Go/Python drift guards for scope allowlist, profile posture, chunk budget, reader
  revision-track selection, provenance idempotency

**Result:**

- `institutional_rules`: 1 document, 26 indexed points, alias published
- `scoped_rules`: 7 documents, 175 indexed points, alias published
- reader assets: 8 gated entries, 0 public entries
- default query allowlist: `institutional_rules` included, `scoped_rules` excluded
- public-chat citation: closed

**Plan:** `phases/phase-10-regulation-serving-admission/PLAN.md`
**Summary:** `phases/phase-10-regulation-serving-admission/SUMMARY.md`

## Phase 11: Second-Batch Manual-Review Admission

**Goal:** 将两个已解决 manual-review regulation rows 通过显式 target
resolution 推进到 selected target materialization，同时保持 serving 与 RAG release
关闭。

**Selected cohort:**

- `481` -> `regulations/scoped_rules`
- `619` -> `regulations/institutional_rules`

**Result:**

- materialized document count: `2`
- postflight target counts:
  - `regulations/institutional_rules=3`
  - `regulations/scoped_rules=16`
- normalization consistency: `passed`
- normalization quality: `passed`
- query serving / RAG release: closed

**Plan:** `phases/phase-11-second-batch-manual-review-admission/PLAN.md`
**Summary:** `phases/phase-11-second-batch-manual-review-admission/SUMMARY.md`

## Phase 12: Regulation Canonical Cleaning Hardening

**Goal:** 修复 619 暴露的清洗边界缺口，确保 regulation 下游 RAG / document site
不再承担正文修补责任。

**Result:**

- `normalize_regulation_owner_text` 升级为
  `collected_notice_regulation_canonical_cleaning_v2`
- canonical cleaning 覆盖通知壳移除、页码 artifact 移除、OCR soft-wrap repair、
  中文语境标点/括号归一
- materialization execute 对 selected documents 强制 `normalization_quality=passed`
- document-units metadata 固化 normalizer / cleaning policy / schema / quality provenance
- RAG release executor 调用 chunk preparation 时要求当前 cleaning provenance；失败转为
  `preparation_failed`，不 index、不 publish

**Verification:**

- `uv run --all-packages python -m unittest tests.ingestion.test_collected_notice_regulation_text_normalization tests.ingestion.test_collected_notice_regulation_first_batch_promotion tests.ingestion.test_regulation_rag_release_lane`
- `uv run --all-packages python -m unittest tests.ingestion.test_prepare_institutional_regulation_chunks_worker tests.ingestion.test_prepare_scoped_rule_chunks_worker tests.ingestion.test_internal_notice_institutional_regulation_chunk_prep tests.ingestion.test_internal_notice_scoped_rule_chunk_prep tests.ingestion.test_process_regulation_rag_release_candidates_worker`

## Phase 13: Historical Regulation Canonical Backfill

**Goal:** 对已采集 historical regulation notices 做统一 canonical backfill，
确保 Phase 9 / Phase 11 selected cohort 先被清洗归一化到 current canonical
artifacts，再进入后续 chunk / RAG release 消费。

**Selected cohort:**

- `594` -> `regulations/institutional_rules`
- `483`, `485`, `487`, `493`, `509`, `564`, `620` ->
  `regulations/scoped_rules`
- `619` -> `regulations/institutional_rules`
- `481` -> `regulations/scoped_rules`

**Result:**

- 新增 `campus_ingestion_core.collected_notice_regulation_canonical_backfill`
- 新增 worker CLI:
  `campus-ingestion-backfill-collected-notice-regulation-canonical`
- first-batch 从 admission manifest + owner text 重建 materialization preview，
  不复用旧 normalized dry-run JSON 作为 canonical text input
- manual-review 从 explicit resolution + owner-text execution report 重建
  materialization preview
- execute 仍复用 selected materialization write gate，非
  `normalization_quality=passed` 不写入
- query serving / RAG release: closed

**Plan:** `phases/phase-13-historical-regulation-canonical-backfill/PLAN.md`
**Summary:** `phases/phase-13-historical-regulation-canonical-backfill/SUMMARY.md`
