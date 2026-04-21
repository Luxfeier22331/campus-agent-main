---
doc_type: plan
status: superseded
created: 2026-04-10
updated: 2026-04-22
---

# Internal Notice 规章制度消费实施文档

## 文档边界

本文固定 `authenticated_notice_portal -> campus_notices/internal_notice -> regulations/*` 这条 non-auth downstream workstream 的前向实施 contract。

它负责：

- 已捕获 `internal_notice` truth 的 regulation downstream consumption
- promotion routing、candidate artifact、target materialization
- `regulations/institutional_regulations` 与 `regulations/scoped_rules` 的 target-side quality hardening

它不负责：

- auth-window `file_release` capture / owner recovery
- shared file asset loader / legacy Office normalization contract
- query-serving reopen
- embedding、Qdrant、release、alias publish

相关边界文档：

- `docs/architecture/authenticated-notice-source-architecture.md`
- `docs/architecture/authenticated-notice-source-truth-contract.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`
- `docs/decisions/adr-0031-authenticated-notice-attachment-typed-routing-and-spatial-review-boundary.md`
- `docs/decisions/adr-0032-internal-notice-notice-family-stratified-admission.md`
- `docs/decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `docs/decisions/adr-0036-notice-derived-non-regulation-rule-boundary.md`
- `docs/decisions/adr-0037-unified-scoped-rules-holding-collection.md`

## Execution Contract

这条线始终按一条单独 workstream 推进：

`source-triage -> regulation promotion -> target materialization -> target-side quality gate`

固定解释：

- 只消费已进入 repo-owned `internal_notice` source-truth / document truth 的 notice 与 attachment owner
- `internal_notice` 继续保留 source / triage truth，不被“改名”成 regulation collection
- `institutional_regulations` 与 `scoped_rules` 只承接通过 promotion gate 的独立 semantic-owner text
- exact active phase、剩余 blocker 与执行进度只写在 `.planning/WORKSTREAMS.md` 与对应 workstream `STATE.md`

## Current Baseline

当前前向 truth 固定为：

- source channel 仍是 `authenticated_notice_portal`
- source-truth unit 固定是 `notice`
- document build 固定采用“父 notice 正文 + attachment child document”两层 projection
- `internal_notice` posture 固定为 `restricted + offline_preparation`
- `internal_notice` 不是 regulation collection
- attachment typed routing 固定为：
  - `reference_only`
  - `text_extractable`
  - `ocr_required`
  - `manual_review_required`
  - `unsupported_binary`
- current canonical source projection path 已接受：
  - `docx/xls/xlsx -> text_extractable`
  - `pdf -> ocr_required`
  - 空间关系主导图片 -> `manual_review_required`
  - 装饰性静态资源 -> `reference_only`
- `.doc` 仍不属于 canonical accepted path；如需支持，只能通过 shared loader workstream reopen

## Target Split

这条线当前固定维护两类 target：

### `regulations/institutional_regulations`

只承接 institution-wide stable regulation。

固定要求：

- target identity 不从 `notice_id` 派生
- target 只接受独立成立的 regulation owner body
- wrapper notice 不得直接充当 target canonical text

### `regulations/scoped_rules`

承接 annual/time-bound scoped rules。

固定要求：

- annual / time-bound operational rules 不回混到 `institutional_regulations`
- `school_unit_name` 继续按 title-first / fail-close 处理
- 无法高置信识别时返回 `None`
- `暂行/试行` 继续保留 `force_status=provisional_in_force`

## Forward Phases

### Phase A: Stabilize Source-Triage Inputs

目标：

- 稳住 `internal_notice` source current scope、inventory 与 admitted regulation frontier
- 确保 source projection、attachment owner 与 provenance 不再漂移

退出条件：

- promotion 输入稳定来自 canonical source-truth inventory 与 document truth
- replay / projection changes 不再改写 target-side语义

### Phase B: Promotion Routing

目标：

- 稳定 `promote_candidate / hold_in_internal_notice / manual_review_required`
- 把 regulation owner body 与 wrapper notice 正文继续分开

退出条件：

- promotion manifest 可重复生成
- duplicate / wrapper / owner-body distinction 可解释且可验证

### Phase C: Candidate Artifact Export

目标：

- 为 target-side review / chunk prep 导出 local-only candidate artifacts

退出条件：

- candidate `canonical.md`、metadata 与 provenance artifact 可回审
- local-only artifacts 不反向定义 target registry truth

### Phase D: Target Materialization

目标：

- 将通过 gate 的 candidate 写入 `institutional_regulations` 或 `scoped_rules`

退出条件：

- target scope refresh 与 source scope refresh 分离
- target canonical markdown、document-units 与 metadata 完整生成
- `internal_notice` source scope 未被改写

### Phase E: Target-Side Quality Acceptance

目标：

- 对 target metadata、chunk-prep input 与 semantic-owner lineage 做 fail-close 验收

退出条件：

- `institutional_regulations` 与 `scoped_rules` 各自拥有独立 acceptance seam
- target-side acceptance 只验证 local-only artifacts，不推进 release / alias publish

## Repo-Tracked Breakdown

repo 当前把上面的前向顺序映射为以下原生 phases：

- `Phase 1`
  - Source Current Scope And Admitted Inventory
- `Phase 2`
  - Promotion Routing
- `Phase 3`
  - Local-only Candidate Artifacts
- `Phase 4`
  - Target Materialization
- `Phase 5`
  - Target-side Chunk And Quality Acceptance
  - 作为 quality umbrella 已完成 planning 收口，并显式拆成 `Phase 6-8`
- `Phase 6`
  - Institutional Regulations Target Chunk-Prep Parity
- `Phase 7`
  - Eleven-Target Acceptance Rerun And Gap Closure
- `Phase 8`
  - Acceptance Evidence Freeze And Closeout

## Exclusions

固定不包含：

- auth-window target-side `file_release` capture 与 owner recovery
- source-wide unfiltered materialization
- shared OCR / legacy Office contract 改写
- query-serving reopen

## Verification Expectations

至少应持续覆盖：

- promotion manifest build
- candidate artifact export
- target materialization
- target-side quality acceptance
- duplicate provenance aggregation
- wrapper stripping / owner-body distinction
- scoped-rules metadata fail-close

## Handoff Rule

后续接手时：

1. 先看 `.planning/WORKSTREAMS.md`
2. 再看对应 workstream `STATE.md`
3. 再回到本文确认长期 phase order 与固定排除项

当前这条 workstream 已恢复到 `Phase 6`。
恢复执行时先按 `Phase 6` 的 parity plan 收口 `institutional_regulations` lane，再顺序进入 `Phase 7-8`；
不要再回到 source-side replay、promotion boundary 或 publish opening 争论。

不要再把 auth-dependent owner recovery、shared loader、release/opening 重新混回本文。
