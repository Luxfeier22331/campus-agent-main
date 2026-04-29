---
doc_type: requirements
status: active
created: 2026-04-30
updated: 2026-04-30
---

<!-- markdownlint-disable MD013 -->

# Requirements: Notice Ingest Fact State Machine

## Goal

建立 collected notice ingest 的 fact-level 状态机，让下游 target admission 基于目标所需事实的 readiness，而不是基于整条
notice 的 media / multimodal pending 状态。

## Functional Requirements

### R1: Source Unit State

每个 valid captured notice 必须能投影出稳定 source unit state：

- `captured`
- `queued`
- `source_truth_ready`
- `searchable_ready`
- `target_candidate`
- `target_replay_evaluated`
- `invalid_capture`

source unit state 不包含 target-specific readiness 结论；它只说明源是否可消费、可检索、可进入候选评估。

### R2: Media Role State

每个 media / attachment candidate 必须有角色和状态：

- media roles:
  - `schedule_table_carrier`
  - `supplemental_location_visual`
  - `visual_text_only`
  - `qr_or_reservation_instruction`
  - `owner_document`
  - `unknown`
- media states:
  - `not_required`
  - `ocr_pending`
  - `ocr_ready`
  - `ocr_low_confidence`
  - `manual_review`
  - `failed_retryable`
  - `failed_terminal`

`unknown` 不得默认升级为 target-blocking carrier；只能产生 `manual_review` 或 target-specific defer。

### R3: Fact Readiness State

每个 target candidate 必须生成 fact readiness：

- `ready_from_text`
- `ready_from_owner_text`
- `ready_from_ocr`
- `ready_from_mixed_sources`
- `partial`
- `missing`
- `blocked_by_required_media`
- `review_required`

fact readiness 必须列出：

- required fact groups
- source channels used by each group
- missing groups
- media blockers scoped to specific groups
- provenance refs back to source unit, body text, owner text, OCR output or media object refs

### R4: Target Admission State

每个 target candidate 必须生成 target admission state：

- `stage_ready`
- `search_only`
- `needs_multimodal`
- `defer`
- `manual_review`
- `blocked`

admission reason codes 必须可枚举、稳定、可测试，并能区分：

- `body_facts_complete`
- `owner_text_facts_complete`
- `ocr_facts_complete`
- `required_fact_missing`
- `required_media_pending`
- `supplemental_media_pending`
- `low_confidence_media_output`
- `target_not_admitted`
- `baseline_source_covered`
- `historical_search_only`
- `expired_temporary_window`
- `manual_review_required`

### R5: Transport Schedule

`transport_schedule` 必须先尝试从正文 / owner text 提取 schedule facts。

Acceptance fixtures:

- `355881`：正文完整，图片是 supplemental location visual；必须产出 7 条 text-primary rows，即使图片 OCR pending。
- `355867`：图片承载 schedule table；必须保持 OCR-primary，不得因 title/body hint 直接 stage。
- official baseline `2026-03-20`：baseline source covered 的历史 rows 必须 search-only 或 baseline-covered，不得重复 current promotion。
- expired temporary windows：默认 searchable，除非显式 admission 到历史/解释 surface。

### R6: Service Status

`service_status` 必须从 target-specific required facts 判断 readiness，例如服务主体、状态、时间窗口、影响范围、恢复/截止信息。

图片 pending 只在它承载 required status facts 时阻断；正文完整的服务状态通知不得被 supplemental image 阻断。

### R7: Regulation

`regulation` / owner document 类必须继续依赖 owner text 或 verified OCR/document extraction。

普通 notice-surface 图片不得把非 regulation 通知升级为 regulation target；`file_release` owner document 才是主要 regulation source。

### R8: Universal Search

所有 valid captured notices 必须 searchable。

searchable preview / read model 可以合并 body text、owner text、OCR text、caption、media metadata 和 target readiness summary，但不得把未验收的 OCR 输出冒充 canonical downstream fact。

### R9: Idempotency And Replay

状态机输出必须可重放：

- idempotency key 以 source identity、content hash、target、fact source hash / media output hash 组成。
- 同一 source/content 的重复 replay 不产生重复 active target rows。
- fact readiness / target admission 输出必须 deterministic。

### R10: Dry-Run No-Write

所有 planning、sample replay、evidence generation 默认 dry-run。

执行写入必须有显式 `--execute` 或既有 writer contract；本 workstream 的前期 phase 不写 DB/object store/release/current truth。

## Non-Goals

- 不引入 Kafka / Temporal / Step Functions。
- 不接管 OCR provider implementation。
- 不改变 collector acquisition provider。
- 不打开新的 user-facing serving surface。
- 不把 target-specific extraction 逻辑放入 query runtime。

## Success Criteria

- `355881` regression fixed by contract: text-complete schedule facts can stage while supplemental image remains pending/review.
- `355867` remains blocked or OCR-primary until required schedule table media is ready.
- service-status and regulation replay consume the same fact readiness contract.
- no code path uses unit-level `multimodal_status` alone as target admission blocker.
- phase evidence includes failure taxonomy, state transition fixtures, media role samples, fact readiness outputs, target replay outputs and guard tests.
