---
phase: "3"
name: "Authority And Completeness"
created: 2026-04-21
updated: 2026-04-21
status: planned
---

# Phase 3 Context

**Gathered:** 2026-04-21
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责：

- 冻结 `semantic_owner` 的 derivation 规则
- 冻结 notice body、attachment body、wrapper text 的 authority / precedence
- 冻结 `attachments_declared` 与 `attachments_captured` 的 consumption-layer 语义
- 冻结 `completeness_status` 与 `answerability` 的 derivation rule
- 明确 `body_only_answerable`、`manual_review_required`、`reference_only`、`authoritative_attachment_missing` 的边界
- 为 `Phase 4` 的 agent/surface handoff 提供稳定的 authority/completeness truth

它不负责：

- 重开 `primary_role`、`default_agent`、`target_surface` 等 schema 字段设计
- 实现 projection builder、query service、tool adapter 或 UI
- admission `file_release` owner recovery，或把它当作当前已消费 owner
- 把 `internal_notice`、`fresh_news` 或其他 surface 直接打开 query-serving
- 重写 attachment OCR / extraction lane 或 terminal outcome family

</domain>

<current_truth>
## Current Truth

- `Phase 1` 已冻结：
  - `source_notice -> notice_attachment -> derived consumption unit`
    三层关系
  - admitted notice source family 闭集继续只有：
    - `official_web_public_notice`
    - `internal_notice_restricted`
- `Phase 2` 已冻结：
  - `derived consumption unit` root schema 属于 data-plane projection contract
  - `semantic_owner` 是正式字段，并至少允许：
    - `notice_body`
    - `attachment_document`
    - `wrapper_notice`
    - `authority_pending`
  - `completeness_status` 与 `answerability` 已经占据正式 schema 位，但 derivation rule 尚未冻结
- `authenticated_notice` 相关 current truth 已经稳定区分：
  - `wrapper_notice_only`
  - `manual_review_required`
  - `reference_only`
  - 可独立消费的正文 owner
- `authenticated_notice` source-truth 与 inventory 已经稳定保留：
  - `attachment_ref_count`
  - `attachment_document_count`
  - `owner_expectation_count`
  - `owner_expectations`
  - `reference_only_count`
  - `manual_review_required_count`
- `internal_notice -> regulations/*` 的当前 promotion truth 已经证明：
  - attachment-backed / file-release-backed owner 缺失时必须 fail-close
  - wrapper notice 不得冒充 canonical owner body
  - `semantic_owner_kind` 是稳定有用的下游 metadata
- `file_release` readiness contract 已经能区分：
  - `ready`
  - `missing_capture`
  - `missing_source_bytes`
  - `ambiguous_match`
  但这条 workstream 当前不负责把 `file_release_document` 直接 admission 为 derived unit root owner

</current_truth>

<decisions>
## Implementation Decisions

- **03-01:** authority / completeness / answerability 必须按 `derived consumption unit` 判定，而不是按整条 `source_notice` 一刀切。
- **03-02:** `attachments_declared != attachments_captured` 只影响依赖该 owner 的 unit；不得因为一个 attachment 缺失，就把同一 notice 的全部 units 一起判成不可答。
- **03-03:** authority / precedence 固定采用“按 unit owner 选主、而不是全局单一优先级”：
  - 当 unit 的 substantive body 来自已捕获 attachment 时，`attachment_document` 是 authoritative owner
  - 当 notice 正文本身已经承载 unit 的完整 answer-bearing body 时，`notice_body` 是 authoritative owner
  - `wrapper_notice` 只承载 announcement / reference / provenance 级事实，不得替代缺失的 attachment/file owner 正文
- **03-04:** `attachments_declared` 固定表示“当前 source notice 明确声明存在的 owner candidates”，来源至少包括：
  - `attachment-refs.jsonl`
  - `owner_expectations`
  - notice body 中显式 `附件` / `参见` / `见文件发布` 一类 owner 指向信号
- **03-05:** `attachments_captured` 固定表示 `attachments_declared` 的已恢复子集；它要求至少具备：
  - 稳定 relation identity
  - 可回链的 source-level capture
  - 已知的 child-document / terminal-outcome 归宿
- **03-06:** 如果 source notice 明确声明存在 authoritative owner，但当前：
  - 没有 recoverable attachment/file owner relation
  - 或没有可消费正文 bytes / child owner truth
  则 `semantic_owner` 必须固定为 `authority_pending`。
- **03-07:** 由于当前 workstream 不 admission `file_release_document` 为 root owner enum，所有 file-release-backed unresolved cases 一律在 consumption layer 归并为：
  - `semantic_owner=authority_pending`
  - 再由 completeness / answerability 决定是否 fail-close
- **03-08:** `completeness_status` 第一版固定只允许：
  - `complete`
  - `authoritative_attachment_missing`
  - `manual_review_required`
  - `reference_only`
- **03-09:** `answerability` 第一版固定至少允许：
  - `answerable`
  - `body_only_answerable`
  - `manual_review_required`
  - `reference_only`
  - `not_answerable`
- **03-10:** `body_only_answerable` 只在 notice body 已经独立满足该 unit 的最小 answer contract 时才成立；它不能因为“看起来像有附件”就被自动赋值。
- **03-11:** `body_only_answerable` 只能支持 notice-runtime 级的有界读取或解释，不得被当作 future `regulations/*` / `service_status_runtime` adoption 的充分依据。
- **03-12:** `manual_review_required` 与 `reference_only` 是显式 terminal outcome，不得被重写成“附件没抓到”：
  - `manual_review_required` = owner 已捕获，但当前 admitted lane 无法自动形成可信 answer-bearing body
  - `reference_only` = 当前只保留 reference / provenance，不主张存在 answer-bearing owner body
- **03-13:** attachment lane 的更细 terminal outcome，例如 `no_extractable_text`、`unsupported_binary`，继续保留在 attachment/runtime lane；本 phase 不把它们全部抬成 root completeness enum，但如果它们阻断了 required owner，则 answerability 必须显式落到非 `answerable` 状态。
- **03-14:** exemplar notice 允许同时出现 mixed outcome：
  - `notice_window` 可以 `complete + answerable`
  - `annual_cycle_rule` 可以 `authority_pending + authoritative_attachment_missing + not_answerable`
  同一 `source_notice` 下二者必须被同时允许。

</decisions>

<specifics>
## Specific Gaps

- 还没有正式写清 `semantic_owner=wrapper_notice` 与 `semantic_owner=authority_pending` 的边界。
- 还没有正式写清“附件已声明但未抓到”与“附件已抓到但只能 manual/reference”不是同一种 completeness 问题。
- 还没有正式写清 `body_only_answerable` 是否允许跨到 future rule/service surface。
- exemplar notice 已经暴露：
  - notice 正文可回答窗口事实
  - 但附件《实施办法》缺失时，年度规则正文不能被 notice 正文冒充

</specifics>

<canonical_refs>
## Canonical References

- `docs/plans/archive/completed/notice-consumption-layer.md`
- `.planning/workstreams/notice-consumption-layer/REQUIREMENTS.md`
- `.planning/workstreams/notice-consumption-layer/ROADMAP.md`
- `.planning/workstreams/notice-consumption-layer/STATE.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-1-source-family-boundary/CONTEXT.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-1-source-family-boundary/RESEARCH.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-1-source-family-boundary/PLAN.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-2-consumption-unit-schema/CONTEXT.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-2-consumption-unit-schema/RESEARCH.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-2-consumption-unit-schema/PLAN.md`
- `docs/data/authenticated-notice-source-truth-schema.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `docs/reference/internal-notice-manual-review-future-query-contract.md`
- `docs/reference/authenticated-notice-file-release-owner-recovery-readiness-contract.md`
- `docs/decisions/adr-0031-authenticated-notice-attachment-typed-routing-and-spatial-review-boundary.md`
- `docs/architecture/system/file-asset-loader-architecture.md`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_truth.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_truth_inventory.py`
- `packages/ingestion-core/src/campus_ingestion_core/authenticated_notice_source_projections.py`
- `packages/ingestion-core/src/campus_ingestion_core/internal_notice_regulation_promotion.py`

### Web Sanity-Check References

- `https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/source/`
- `https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/hasPart/`
- `https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/isPartOf/`
- `https://support.datacite.org/docs/versioning`

</canonical_refs>

<deferred>
## Deferred Follow-up

- `Phase 4`
  - `default_agent` / `target_surface` 如何消费 `body_only_answerable`
  - 哪些 units 继续停留在 `notice_runtime`
  - 哪些 units 具备进入 future rule/service surface 的前提
- `Phase 5`
  - 用 bounded exemplar 做 worked example closeout
  - adoption routing / verification
- future implementation
  - projection builder
  - runtime tool adoption
  - `file_release` owner recovery execution

</deferred>
