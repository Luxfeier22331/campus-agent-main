---
doc_type: plan
status: completed
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 2 Plan: Chain Contract And Admission Design

## Goal

在清旧状态前冻结首期完整链路 contract，避免 reset 后继续沿用旧 projection/stage 方式。

## Tasks

1. 定义 universal searchable notice layer 的最小字段和 provenance。
2. 定义 consumer admission manifest schema。
3. 定义五类消费状态：`search_only`、`downstream_admitted`、`defer`、`needs_multimodal`、`invalid_capture`。
4. 定义 regulation / transport_schedule / service_status 的首期 admission 规则。
5. 定义 dry-run no-write contract 和 report shape。
6. 固定 Phase 3 reset 边界：清 source-truth / holding / registry import rows，恢复为 captured-but-not-imported。
7. 固定 mixed `service_guide` current release 处理：按 source lineage 清 notice-derived，保留稳定 PDF/handbook/campus-card。
8. 补 fixture 覆盖所有消费状态与三个 downstream target。

## Phase 2 Decisions

### Source-Truth / Holding Reset Boundary

Phase 3 reset 选择清除 source-truth / holding / registry import rows。

理由：

- 本 workstream 的目标态是恢复到 `已采集未导入`，等完整链路设计完成后重新 dry-run 导入。
- 只清 projection/read-model 会留下 `已导入但未消费` 状态，不符合当前目标。
- 旧 source-truth / holding rows 会干扰后续 reimport dry-run 的覆盖率、去重与 provenance 判断。

Phase 3 必须保留：

- source bucket 原始采集对象。
- collector run ledger。
- object locator evidence。
- 采集 run evidence。

Phase 3 必须清除：

- authenticated notice source-truth inventory。
- authenticated notice file-release inventory。
- 由 authenticated notice / file_release 导入产生的 document holding、raw asset registry、document registry rows。
- projection、read-model、admission、OCR/multimodal attempt 与 typed downstream 派生态。

### Mixed Service-Guide Current Release Handling

`service_guide` 不做整表删除；必须按 source lineage 清理。

删除：

- source/ref 指向 `notice:muc_internal_portal:*` 的 notice-derived rows。
- smoke / e2e / stage / preview release rows。
- transport notice-derived service-guide rows。

保留：

- handbook / `student_rules` 旧 PDF 稳定消费结果。
- campus-card 等非 notice-derived stable source rows。
- 非本 workstream 产生的 stable service-guide rows。

current release 处理规则：

- 如果存在 stable-only release，则 Phase 3 可把 `service_guide` current 指回 stable-only release。
- 如果只有 mixed current release，则 Phase 3 先删除 notice-derived read-model rows，并将 `service_guide` current 标为 `manual_review_required`，不得伪造干净 current。
- Phase 6 不重新打开 `service_guide`，除非后续显式把它重新 admission 为 target。

## Acceptance

- 所有 valid captured notice 都有 searchable destination。
- 未 admission source 不能进入 typed downstream。
- OCR/多模态结果必须可追溯，不直接编造成 target truth。
- Phase 3 reset manifest 必须清 source-truth / holding / registry import rows，同时保留 captured objects 与 collector run ledger。
- `service_guide` reset 必须按 source lineage 保留稳定 PDF/handbook/campus-card rows，不能整表清除。

## Completion Artifacts

- `CHAIN-CONTRACT.md`
- `CONSUMER-ADMISSION-SCHEMA.md`
- `SEARCHABLE-NOTICE-LAYER-SCHEMA.md`
- `DOWNSTREAM-BATCHING-POLICY.md`
- `DRY-RUN-REPORT-CONTRACT.md`
- `fixtures/consumer-admission-fixture.v1.json`
- `SUMMARY.md`
