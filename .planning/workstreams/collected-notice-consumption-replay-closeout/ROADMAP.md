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
- [x] **Phase 3: Reset Derived State To Collected-Only** — 按 manifest 清除旧 projection/read-model/OCR attempt/typed release/stage/current，保留 source bucket 和 collector run ledger。
- [x] **Phase 4: Dry-Run Reimport And Universal Search Preview** — 用已采集 run/object refs 做 no-write reimport preview，生成全量 searchable projection/read-model 预览。
- [x] **Phase 4.5: Notice Ingest Queue Contract** — 已冻结历史库存与未来 live discovery 共用的 `notice_ingest` job contract、idempotency key 与 queue state machine。
- [x] **Phase 4.6: PG-Backed Queue Store And Lease Runtime** — 实现 shared PG queue store、lease / heartbeat / retry / dead-letter runtime。
- [x] **Phase 4.7: Historical Captured Inventory Synthetic Enqueue** — 把已采集库存通过 synthetic enqueue plan 进入统一 ingest queue，不绕过 worker 直导。
- [x] **Phase 4.8: Queue Consumer Reimport Path** — 让 ingestion worker 从 queue 消费 object refs，重用 source-truth / holding / searchable reimport path。
- [x] **Phase 5: Multimodal OCR Consumption Readiness** — 统一 notice 侧多模态消费 ledger / attempt / normalized-output contract，把图片、PDF、附件类通知纳入 OCR/多模态 pending/done/failed 状态，并让结果进入 searchable text preview。
- [ ] **Phase 6: Batched Downstream Replay** — 先完成 `transport_schedule` 单条 notice no-write pilot 与 target batch dry-run，再补 baseline-aware transport policy；随后对 `regulation`、`service_status` 显式 admission 子集分批 dry-run / stage / consistency check。
- [x] **Phase 6.1: Transport Baseline-Aware Admission Policy** — 在 baseline 文件到位前，已补 transport admission 的 baseline / temporal / overlay / OCR priority 字段，防止历史图片通知盲目 OCR 或盲目 stage。
- [x] **Phase 6R.1: Regulation Candidate Audit And Admission** — 基于 queue-backed searchable layer 生成 regulation 候选全集 audit 与 no-write admission manifest；已在 Phase 6R.1b owner-text recovery 后重跑，当前 `106` 个 regulation-like source 中 `82` 个等待 multimodal/OCR，`16` 个 manual review，`8` 个 downstream admitted。
- [x] **Phase 6R.1a: Regulation Owner Text Recovery Mini-Batch** — 基于 Phase 6R.1 `needs_multimodal` 与 Phase 5 multimodal inventory 生成 no-write owner-text recovery mini-batch；`39` 个 file_release regulation entries 中 `37` 个有可恢复 PDF/Office attempts，首批选择 `10` 个，`2` 个 gap，未执行 provider 或写入。
- [x] **Phase 6R.1b: Regulation Owner Text Recovery Execution** — 对 Phase 6R.1a 首批 `10` 个 file_release PDF attempts 显式执行 `--execute`；MinerU 产出 `10/10` owner text ready，写入 provider response、plain text、layout elements 与 searchable merge input refs，DB 写入保持关闭。
- [x] **Phase 6R.2: Regulation Promotion Dry-Run And Gated Materialization** — 复用刷新后的 Phase 6R.1 admission manifest，对 `8` 个 downstream-admitted regulation candidates 生成 `institutional_rules` / `scoped_rules` target preview，停在 offline preparation；consistency verdict 为 `passed`，未写 DB/object store/release/query-serving。
- [x] **Phase 6R.3: Regulation Normalization Quality Gate** — 已补齐规章制度 canonical text 归一化质量门禁，8 个 downstream-admitted preview docs 全部通过 quality gate；`594` wrapper residue 已移除，生成 before/after dry-run evidence，仍保持 no-write、offline preparation。
- [ ] **Phase 6.2: Official Transport Baseline Ingest And Overlay Reclassification** — 等 `2026-03-01` 官方车次表到位后，将其作为 current baseline 基底，并重算 notice-derived delta / temporary overlay / historical search-only 分类。
- [ ] **Phase 6.3: Schedule Image OCR Mini Batch** — 只对 baseline-aware policy 判定为 current/recent/delta-relevant 的 schedule 图片执行 OCR/multimodal mini batch，并用输出重跑 transport dry-run。
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
- `invalid-defer-requires-multimodal-report.json`

**Checks:**

- 每个 valid captured notice 都有 searchable unit。
- search preview 包含 title、published_at、source URL、source object refs、body text、attachment refs、OCR/multimodal status。
- invalid capture 被明确列入 rejection report。
- dry-run 不写 DB / object store。

## Phase 4.5: Notice Ingest Queue Contract

**Goal:** 冻结历史库存和未来 live discovery 共用的 `notice_ingest` job
contract，避免历史重放和持续更新形成两条消费链路。

**Deliverables:**

- `NOTICE-INGEST-QUEUE-CONTRACT.md`
- `SUMMARY.md`
- job schema fixture covering `historical_backfill`、`live_discovery`、`manual_replay`
- queue state machine:
  - `queued`
  - `leased`
  - `succeeded`
  - `failed_retryable`
  - `failed_terminal`
  - `dead_letter`
- idempotency key policy
- focused queue contract tests

**Checks:**

- job 只携带 object refs、source identity、content hash、run id 和 replay metadata。
- job 不携带正文、HTML、附件 bytes 或 OCR payload。
- collector、historical backfill、manual replay 共享同一个 job contract。
- 不涉及 scheduler、认证续期、live collector rollout 或 downstream admission。

## Phase 4.6: PG-Backed Queue Store And Lease Runtime

**Goal:** 用 shared PostgreSQL 实现首期 durable ingest queue，支持
idempotent enqueue、lease、heartbeat、retry、terminal failure 和 dead-letter。

**Deliverables:**

- queue schema / table definition
- queue store implementation
- lease / heartbeat / complete / fail / dead-letter operations
- read-only queue status worker
- focused memory and PG store tests

**Checks:**

- 重复 enqueue 不产生重复 active job。
- worker crash 后 expired lease 可重新领取。
- 非 lease owner 不允许 heartbeat / complete / fail。
- retry max attempts 后进入 `dead_letter`，不 silent drop。

**Completion:** shared DTO / memory store / Postgres store / read-only status
CLI 已实现并有 focused tests；本 phase 未执行 historical enqueue，也未写
source-truth、searchable 或 downstream state。

## Phase 4.7: Historical Captured Inventory Synthetic Enqueue

**Goal:** 从已采集 run ledger / object inventory 生成 queue jobs，让历史库存也通过
统一 ingest queue 消费。

**Deliverables:**

- `historical-enqueue-plan.dry-run.json`
- `historical-enqueue-rejected-deferred-report.json`
- `enqueue-coverage-report.json`
- `historical-enqueue.execute.json` when explicitly run with `--execute`

**Checks:**

- 不重新采集。
- 不把本地文件系统当 source truth。
- dry-run 默认不写 queue。
- execute 只写 queue jobs，不写 source-truth、searchable 或 downstream。
- missing object refs / unsupported source surfaces 有稳定 reason codes。

**Completion:** 已从 Phase 4 reimport manifest 生成 dry-run enqueue plan：
`338` 个 queue jobs、`18` 条 Phase 4 rejected run refs 保留在 rejection report、
coverage verdict 为 `passed`，未执行 queue 写入。

## Phase 4.8: Queue Consumer Reimport Path

**Goal:** ingestion worker 从 `notice_ingest` queue 消费 object refs，重用
Phase 4 source-truth / holding / searchable 逻辑。

**Deliverables:**

- queue consumer worker
- dry-run consume evidence
- source -> queue -> source-truth/searchable trace
- failed/retryable/terminal job report
- queue-backed searchable coverage report

**Checks:**

- queue job 成功后能生成 source-truth / holding / searchable preview 或真实写入。
- failed job 不 silent drop。
- all valid consumed notices 进入 searchable。
- downstream admission 不在本 phase 自动执行。

**Completion:** 已实现 queue consumer core 与 worker CLI；dry-run 使用 Phase 4.7
historical enqueue plan 作为 in-memory queue seed，消费 `25` 个 job，生成 `25`
个 searchable units、`25` 个 source-truth candidates，failed `0`，coverage
verdict 为 `passed`。Execute mode 需要显式 writer 成功后才会 complete job。

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

**Current slice:** `transport_schedule` target batch 已生成 no-write admission /
replay / stage / consistency / trace evidence；下一步先进入 Phase 6.1
baseline-aware transport admission policy。`regulation` 与 `service_status`
batch 暂不开始。

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

## Phase 6.1: Transport Baseline-Aware Admission Policy

**Goal:** 在 baseline 文件到位前，先冻结 transport schedule 的 admission
分层规则，避免把历史图片通知全量 OCR 或把 OCR-ready 历史通知直接 stage。

**Deliverables:**

- `TRANSPORT-BASELINE-AWARE-ADMISSION-POLICY.md`
- `SUMMARY.md`
- updated `transport_schedule` admission manifest fields:
  - `baseline_status`
  - `baseline_effective_date`
  - `temporal_relation`
  - `overlay_kind`
  - `ocr_priority`
  - `current_eligible`
  - `baseline_gate_reason_codes`
- refreshed `batch-transport-schedule` no-write evidence.
- regression fixture covering baseline missing / post-baseline delta /
  temporary overlay / historical search-only / awaiting baseline.

**Checks:**

- baseline missing 时，不允许 schedule image pending source 被 promotion 或
  downstream stage。
- high-value 图片不被 low-value skip，但可进入 `defer_until_baseline`。
- operator 能从 manifest 看出每条 blocked notice 是等 baseline、等 OCR、已过期，
  还是需要人工复核。

## Phase 6R.1: Regulation Candidate Audit And Admission

**Goal:** 基于 queue-backed searchable layer 做 regulation 候选全集 audit，
生成 no-write admission manifest，不直接 materialize `regulations/*`。

**Status:** completed on 2026-04-29. Evidence is under
`evidence/phase-06-r1-regulation-candidate-audit-and-admission/`.

**Result:** `106` candidates were classified from all `338` queue-backed
historical jobs: `92` `needs_multimodal`, `14` `manual_review`, `0`
`downstream_admitted`. The zero-admission outcome is intentional: no current
source has canonical regulation owner text ready for materialization.

**Deliverables:**

- `regulation-consumer-admission-manifest.json`
- `regulation-candidate-audit.json`
- `regulation-rejected-deferred-source-report.json`
- `regulation-source-to-searchable-trace.json`

**Admission classes:**

- `institutional_rules_candidate`
- `scoped_rules_candidate`
- `needs_multimodal`
- `wrapper_only_searchable`
- `duplicate_hold`
- `manual_review`
- `invalid_capture`

**Checks:**

- wrapper notice 不进入 `regulations/*`。
- `notice_id` 不作为 target document id。
- 所有候选可回链 searchable unit 和 source object refs。
- query-serving 默认关闭。

## Phase 6R.1a: Regulation Owner Text Recovery Mini-Batch

**Goal:** 从 Phase 6R.1 `needs_multimodal` regulation candidates 中选择
file-release PDF/Office owner documents，生成 no-write recovery batch plan。

**Status:** completed on 2026-04-29. Evidence is under
`evidence/phase-06-r1a-regulation-owner-text-recovery-mini-batch/`.

**Result:** Phase 6R.1 的 `92` 个 `needs_multimodal` entries 中，`39` 个
属于 file_release regulation owner document scope；其中 `37` 个有 Phase 5
pending PDF/Office candidate，首批选择 `10` 个，`27` 个因 mini-batch limit
deferred，`2` 个缺 matching multimodal candidate，notice-surface `53` 个
继续 out-of-scope deferred。

**Deliverables:**

- `regulation-owner-text-recovery-batch-manifest.json`
- `regulation-owner-text-attempt-plan.json`
- `regulation-owner-text-searchable-merge-contract.json`
- `regulation-owner-text-readiness-gap-report.json`

**Checks:**

- dry-run 不调用 provider。
- dry-run 不写 object store 或 DB。
- attempt plan 保留 source object ref、normalized output refs、candidate key
  与 target collection。
- owner text ready 后必须重跑 Phase 5 / Phase 6R.1 / Phase 6R.2。
- 不 materialize `regulations/*`。

## Phase 6R.1b: Regulation Owner Text Recovery Execution

**Goal:** 对 Phase 6R.1a selected mini-batch 执行 provider-backed owner-text
recovery，并只写 attempt plan 声明的 normalized output refs。

**Status:** completed on 2026-04-29. Evidence is under
`evidence/phase-06-r1b-regulation-owner-text-recovery-execution/`.

**Result:** no-write dry-run 确认 `10` 个 selected attempts 在未传
`--execute` 时不会调用 provider 或写 object store。真实 execute 使用
`mineru_api` / `vlm` 处理首批 `10` 个 PDF attempts，`10` 个成功、
`0` 个失败、`10` 个 owner_text_ready，DB 写入保持关闭。

**Deliverables:**

- `dry-run/regulation-owner-text-execution-report.json`
- `regulation-owner-text-execution-report.json`
- object-store `provider_response`
- object-store `plain_text`
- object-store `layout_elements`
- object-store `searchable_merge_input`

**Checks:**

- default mode 不写 object store、不调用 provider。
- execute mode 仅处理 Phase 6R.1a selected attempts。
- success outputs 只写入 attempt plan 中声明的 refs。
- failed attempt 不写 success outputs。
- 不 materialize `regulations/*`。
- 不写 DB。

## Phase 6R.2: Regulation Promotion Dry-Run And Gated Materialization

**Goal:** 对 owner-text-ready 且 Phase 6R.1 admitted candidates 运行 no-write
target materialization preview，分别产出 `institutional_rules` 与
`scoped_rules` 预览，停在 `offline_preparation`。

**Status:** completed on 2026-04-29. Evidence is under
`evidence/phase-06-r2-regulation-promotion-dry-run-and-gated-materialization/`.

**Result:** `8` downstream-admitted regulation candidates generated `1`
institutional preview document and `7` scoped-rule preview documents. Consistency
verdict is `passed`; no release, alias publish, DB write, object-store write,
embedding, Qdrant write, or query-serving opening occurred.

**Deliverables:**

- `institutional-rules-materialization.dry-run.json`
- `scoped-rules-materialization.dry-run.json`
- canonical markdown preview
- document-units preview
- duplicate provenance aggregation report
- materialization consistency report
- source-to-target trace

**Checks:**

- `institutional_rules` 只收 institution-wide stable regulation。
- 年度/学院/招生/时限型规则进入 `scoped_rules`。
- duplicate source 聚合 provenance，不生成第二份 target doc。
- 不 release、不 alias publish、不 query-serving。
- `internal_notice` source scope 不被改写。

## Phase 6R.3: Regulation Normalization Quality Gate

**Goal:** 在进入 Phase 7 acceptance 前，把 Phase 6R.2 暴露出的规章制度
canonical text 质量问题收口成可重复的 no-write quality gate。

**Status:** completed on 2026-04-29. Evidence is under
`evidence/phase-06-r3-regulation-normalization-quality-gate/`.

**Result:** `8` downstream-admitted regulation preview documents passed the
normalization quality gate: `1` institutional document, `7` scoped-rule
documents, `0` failed, `0` flagged. Source notice `594` no longer retains
wrapper residue in target canonical markdown.

**Deliverables:**

- normalization fixture set covering the current `8` downstream-admitted
  regulation preview documents.
- improved canonical text normalizer for regulation target previews.
- wrapper-stripping guard that avoids matching quoted titles inside
  `关于印发/发布/修订《...》的通知` wrapper text.
- OCR/layout artifact cleanup for page markers, duplicated title blocks, broken
  heading spacing, and suspicious leading wrapper fragments.
- structure-aware document units preview based on chapter/article headings when
  available, with blank-line fallback only when no structure exists.
- per-document quality report:
  - `wrapper_removed`
  - `suspicious_prefix`
  - `title_occurrence_count`
  - `chapter_count`
  - `article_count`
  - `page_artifact_count`
  - `quality_verdict`
- before/after dry-run comparison evidence under
  `evidence/phase-06-r3-regulation-normalization-quality-gate/`.

**Checks:**

- `594` must no longer retain `》的通知` or wrapper notice preamble in target
  canonical markdown.
- Existing clean scoped rules must not regress.
- Target identity, source provenance, no-write boundary, and offline-preparation
  stop point remain unchanged from Phase 6R.2.
- Quality report must fail or flag documents with wrapper residue, duplicated
  title preambles, or too few structural markers.
- No DB write, object-store write, release publish, embedding, Qdrant write, or
  query-serving opening.

## Phase 6.2: Official Transport Baseline Ingest And Overlay Reclassification

**Goal:** 将用户提供的 `2026-03-01` 官方车次表作为 transport schedule current
baseline 基底，并基于该 baseline 重算 notice-derived overlays。

**Deliverables:**

- official baseline source-truth / projection dry-run evidence.
- baseline release candidate with `effective_from=2026-03-01`.
- reclassified transport notice report:
  - `baseline_delta_candidate`
  - `temporary_overlay`
  - `temporary_exception`
  - `historical_search_only`
  - `manual_review`
- refreshed transport batch admission evidence.

**Checks:**

- baseline 是 current schedule 的唯一基底。
- 历史 notice 不得覆盖 baseline，除非显式 delta / overlay admission。
- temporary overlay 必须有明确 service window 或 manual review reason。
- current promotion 仍默认关闭，除非后续单独打开。

## Phase 6.3: Schedule Image OCR Mini Batch

**Goal:** 只对 baseline-aware policy 判定为 current/recent/delta-relevant 的
schedule 图片执行 OCR/multimodal mini batch，然后重跑 transport dry-run。

**Deliverables:**

- OCR execution manifest for eligible schedule images.
- provider response refs.
- normalized visual text / layout / table refs.
- searchable merge preview.
- refreshed transport admission / replay / stage / consistency / trace evidence.
- OCR failure / manual review report.

**Checks:**

- OCR execution 只处理 eligible image refs，不全量扫历史图片资产。
- provider/model/provenance/object refs 完整写入 evidence。
- OCR 成功不等于自动 stage；仍需结构化 extractor 和 consistency gate。
- OCR 失败 source 保留 searchable metadata，并进入 `manual_review` 或
  `needs_multimodal_failed`，不得 silent skip。

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
