---
doc_type: plan
status: planned
created: 2026-04-29
updated: 2026-04-29
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Plan: Reset Derived State To Collected-Only

## Goal

执行经过确认的 reset，保留采集事实，清除旧消费/下游派生态。

本 phase 是 Phase 2 reset 决策的执行 phase。Phase 2 负责冻结边界，Phase 3
负责按该边界实现、dry-run、backup、execute 与 post-reset audit。

## Tasks

1. 实现或复用 reset dry-run 命令，输出表级/row-level 删除计划。
2. 在正式 reset 前导出 backup artifact。
3. 清除 source-truth / holding / registry import rows，使状态回到 captured-but-not-imported。
4. 删除 projection/read-model/admission/OCR attempt 旧数据。
5. 删除或撤回 notice-derived typed release/stage/current/read-model rows。
6. 对 mixed `service_guide` current release 执行 source-lineage 清理，保留稳定 PDF/handbook/campus-card rows。
7. 运行 post-reset audit，证明 remaining state 是 captured-but-not-imported。

## Reset Scope

Phase 3 必须保留：

- source bucket 原始采集对象。
- collector run ledger。
- object locator evidence。
- 采集 run evidence。

Phase 3 必须清除：

- `authenticated_notice_source_truth_inventory`。
- `authenticated_notice_file_release_inventory`。
- 由 authenticated notice / file_release 导入产生的 document holding rows。
- 由 authenticated notice / file_release 导入产生的 raw asset registry rows。
- 由 authenticated notice / file_release 导入产生的 document registry rows。
- `notice_consumption_projection`。
- `internal_notice_read_model`。
- `internal_notice_consumption_admission*`。
- `internal_notice_multimodal_attempt`。
- `internal_notice_schedule_image_ocr_attempt`。
- `wechat_public_notice_multimodal_attempt`。
- notice-derived `service_status` / `transport_schedule` release、stage、current、read-model rows。

## Service Guide Lineage Rule

`service_guide` reset 不允许整表删除。

删除：

- source/ref 指向 `notice:muc_internal_portal:*` 的 notice-derived rows。
- smoke / e2e / stage / preview release rows。
- transport notice-derived service-guide rows。

保留：

- handbook / `student_rules` 旧 PDF 稳定消费结果。
- campus-card 等非 notice-derived stable source rows。
- 非本 workstream 产生的 stable service-guide rows。

current release 处理：

- 如果存在 stable-only release，Phase 3 可把 `service_guide` current 指回 stable-only release。
- 如果只有 mixed current release，Phase 3 只删除 notice-derived read-model rows，并将 `service_guide` current 标为 `manual_review_required`，不得伪造 clean current。
- `service_guide` 不在 Phase 6 downstream target 列表中，除非后续显式重新 admission。

## Acceptance

- source bucket objects 与 collector run ledger 未删除。
- source-truth / holding / registry import rows 被清到 captured-but-not-imported 边界。
- derived/downstream 污染项归零或只剩明确豁免项。
- stable PDF/handbook/campus-card service-guide rows 被保留。
- reset execute report 与 dry-run manifest 对齐。
