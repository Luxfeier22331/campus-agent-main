---
doc_type: roadmap
status: active
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Collected Notice Consumption Replay Closeout

## Overview

本 roadmap 先冻结首期完整链路，再清理旧 derived state，最后 dry-run 重放已采集内容，并按全量 searchable 与分批 downstream 两条路径验收。

## Phase Status

- [x] **Phase 1: Current-State Audit And Reset Manifest** — 只读盘点当前 captured/source/imported/consumed 状态，生成 reset manifest 与 backup 计划。
- [x] **Phase 2: Chain Contract And Admission Design** — 冻结 `search_only / downstream_admitted / defer / needs_multimodal / invalid_capture` 分类、manifest schema、dry-run no-write contract 与 downstream target admission 规则。
- [ ] **Phase 3: Reset Derived State To Collected-Only** — 按 manifest 清除旧 projection/read-model/OCR attempt/typed release/stage/current，保留 source bucket 和 collector run ledger。
- [ ] **Phase 4: Dry-Run Reimport And Universal Search Preview** — 用已采集 run/object refs 做 no-write reimport preview，生成全量 searchable projection/read-model 预览。
- [ ] **Phase 5: Multimodal OCR Consumption Readiness** — 统一 notice 侧多模态消费 ledger / attempt / normalized-output contract，把图片、PDF、附件类通知纳入 OCR/多模态 pending/done/failed 状态，并让结果进入 searchable text preview。
- [ ] **Phase 6: Batched Downstream Replay** — 对 `regulation`、`transport_schedule`、`service_status` 三类显式 admission 子集分批 dry-run / stage / consistency check。
- [ ] **Phase 7: Acceptance And Closeout** — 验证全量可检索、未 admission 不进 downstream、已 admission 可回链，并完成 evidence 与 workstream closeout。

## Phase 1: Current-State Audit And Reset Manifest

**Goal:** 不写数据，确认当前到底有哪些已采集、已导入、已消费和污染项。

**Deliverables:**

- `captured-runs-inventory.json`
- `source-truth-inventory-audit.json`
- `derived-state-inventory.json`
- `downstream-release-inventory.json`
- `reset-manifest.dry-run.json`
- `reset-backup-plan.md`

**Checks:**

- collector run ledger 按 `source_surface / status / verification_status` 分组。
- source-truth inventory 按 `corpus / collection / multimodal_required` 分组。
- downstream 表按 release id、target surface、consumer admission batch 分组。
- 明确哪些状态保留，哪些状态清除，哪些需要人工确认。

## Phase 2: Chain Contract And Admission Design

**Goal:** 在清理前冻结重新导入和消费的 contract，避免 reset 后继续用旧路径重放。

**Deliverables:**

- `CHAIN-CONTRACT.md`
- `CONSUMER-ADMISSION-SCHEMA.md`
- `SEARCHABLE-NOTICE-LAYER-SCHEMA.md`
- `DOWNSTREAM-BATCHING-POLICY.md`
- `DRY-RUN-REPORT-CONTRACT.md`
- phase-specific fixture：至少覆盖 `search_only`、`needs_multimodal`、`transport_schedule`、`service_status`、`regulation`、`defer`、`invalid_capture`。

**Checks:**

- all captured valid notices 必须有 searchable destination。
- downstream 只能通过 admission manifest。
- dry-run 不允许写。
- OCR/多模态结果只作为 searchable 或 target evidence，不直接编造 target truth。

## Phase 3: Reset Derived State To Collected-Only

**Goal:** 清除旧消费状态，恢复到已采集但未重新消费的干净基线。

**Keep:**

- source bucket 原始采集对象。
- collector run ledger。
- object locator audit evidence。
- run evidence 与 backup artifacts。

**Reset:**

- `notice_consumption_projection`
- `internal_notice_read_model`
- `internal_notice_consumption_admission*`
- `internal_notice_multimodal_attempt`
- `internal_notice_schedule_image_ocr_attempt`
- `wechat_public_notice_multimodal_attempt`
- notice-derived `service_status` / `service_guide` / `transport_schedule` release、stage、current、read-model rows。

**Deliverables:**

- `reset-derived-state.dry-run.json`
- `reset-derived-state.backup.json`
- `reset-derived-state.execute.json`
- `post-reset-collected-only-audit.json`

**Checks:**

- reset 后 source bucket 和 run ledger 仍可验证。
- reset 后 derived tables 没有旧污染。
- reset 后不能丢失 captured source identity。

## Phase 4: Dry-Run Reimport And Universal Search Preview

**Goal:** 在不写入的前提下，用已采集对象预览 source-truth / document holding / searchable layer。

**Deliverables:**

- `reimport-plan.dry-run.json`
- `source-truth-preview.json`
- `searchable-notice-preview.json`
- `searchable-coverage-report.json`

**Checks:**

- 每个 valid captured notice 都有 searchable unit。
- search preview 包含 title、published_at、source URL、source object refs、body text、attachment refs、OCR/multimodal status。
- invalid capture 被明确列入 rejection report。
- dry-run 不写 DB / object store。

## Phase 5: Multimodal OCR Consumption Readiness

**Goal:** 图片、PDF、附件承载正文或班次信息时，不再停留在不可检索状态。

**Deliverables:**

- `multimodal-candidate-inventory.json`
- `NOTICE-MULTIMODAL-CONSUMPTION-CONTRACT.md`
- `multimodal-state-mapping-report.json`
- `ocr-batch-manifest.dry-run.json`
- `ocr-attempt-plan.json`
- `multimodal-searchable-merge-preview.json`
- `multimodal-gap-report.json`

**Checks:**

- image / PDF / Office attachment 均有处理策略。
- schedule image OCR、internal notice multimodal 与 WeChat multimodal attempt 能映射到统一 ledger / attempt / normalized-output 口径。
- 统一 contract 只管理候选、状态、attempt、provider output refs、normalized visual text/layout/table、searchable merge 和 downstream readiness，不吞并 provider 实现或 target-specific extraction。
- high-value schedule/status/regulation media 不被 skip。
- low-value ephemeral poster 可以保留 searchable metadata 但必须记录 skip reason。
- OCR 结果必须带 provider/model/object refs/provenance。

## Phase 6: Batched Downstream Replay

**Goal:** 只让已设计好的目标进入 typed downstream，且每类目标分批 replay。

**Target batches:**

- `regulation`
- `transport_schedule`
- `service_status`

**Deliverables:**

- 每个 target 的 `consumer-admission-manifest.json`
- 每个 target 的 `replay.dry-run.json`
- 每个 target 的 `stage-report.json`
- 每个 target 的 `consistency-report.json`
- rejected/deferred source report。

**Checks:**

- 未 admission source 不进入 typed downstream。
- admission source 必须可回链到 searchable notice row。
- transport schedule 依赖 OCR/结构化 evidence 的通知，不允许缺 OCR 直接 stage。
- service status current promotion 必须显式，不能被 replay 默认打开。
- regulation target 先进入 gated materialization，不默认打开 query-serving。

## Phase 7: Acceptance And Closeout

**Goal:** 固化首期结果，证明当前已采集内容被干净、可追溯、可重复地消费。

**Deliverables:**

- `end-to-end-acceptance.json`
- `searchable-sample-smoke.json`
- `downstream-target-sample-smoke.json`
- `source-to-search-to-downstream-trace.json`
- `WORKSTREAM-CLOSEOUT.md`

**Checks:**

- source count、searchable count、downstream count、defer count、invalid count 对齐。
- searchable layer 可检索所有 valid captured notices。
- downstream target 只包含 admitted notices。
- OCR pending/done/failed 可观测。
- reset/replay/evidence 足以支持后续定时团队接入，但本线不实现定时。
