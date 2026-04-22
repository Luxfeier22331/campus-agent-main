---
phase: "3"
artifact: "research"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 3 Research

## Purpose

把 `Phase 3: Authority And Completeness` 建立在三类真相之上：

- `Phase 1-2` 已冻结的 source family / schema boundary
- repo 已落地的 authenticated notice source-truth、attachment terminal outcome 与 downstream owner-resolution pattern
- 有限联网 sanity-check，用官方 metadata / versioning 术语验证“wrapper notice、attachment relation、derived unit version”这三层关系的合理性，但不让外部资料覆盖 repo truth

## Repo Pattern Readings

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

## Web Sanity-Check References

- DCMI `source`
  - https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/source/
- DCMI `hasPart`
  - https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/hasPart/
- DCMI `isPartOf`
  - https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/isPartOf/
- DataCite Versioning
  - https://support.datacite.org/docs/versioning

说明：

- 这些外部资料只作为术语 sanity-check。
- repo 级 authority/completeness contract 仍以本地 architecture / ADR / code truth 为准。

## Findings

### 1. authority / completeness 必须按 derived unit，而不是按整条 notice 判定

- `Phase 1` 已经冻结：一条 `source_notice` 允许 fan-out 到多个 derived units。
- `Phase 2` 已经冻结：`semantic_owner`、`completeness_status`、`answerability` 都是 unit 级字段。
- 因此 `attachments_declared != attachments_captured` 的真实影响范围只能是“依赖该 owner 的 units”，不能把整条 notice 一起判成 fail-close。

### 2. repo 已经有可复用的 owner / wrapper / missing-owner pattern

- `internal_notice -> regulations/*` 的 promotion 逻辑已经稳定区分：
  - `notice_body`
  - `attachment_document`
  - `wrapper_notice`
  - missing owner reason
- 当前 regulation flow 甚至已经把 file-release-backed 缺失和 attachment-backed 缺失显式区分，但 notice consumption layer 还不需要把 `file_release_document` admission 成 root owner enum。
- 因此 `Phase 3` 的正确动作不是发明一套新 owner 词汇，而是把现有 owner 解析上收为 source-family-neutral consumption rule。

### 3. `attachments_declared` 与 `attachments_captured` 的差值已经有 repo-level evidence 来源

- source-truth contract 已冻结：
  - `attachment-refs.jsonl`
  - `owner_expectations`
- inventory store 已冻结：
  - `attachment_ref_count`
  - `attachment_document_count`
  - `owner_expectation_count`
  - `manual_review_required_count`
  - `reference_only_count`
- 这意味着 `Phase 3` 可以把“声明了 owner 但未恢复出来”与“owner 已捕获但 current lane 只能 manual/reference”正式分开，而不需要靠 query-time 猜测。

### 4. `manual_review_required` 与 `reference_only` 是终态，不是缺失 capture

- `ADR-0031`、`internal_notice` offline-preparation strategy、file-asset-loader architecture 都已经明确：
  - `manual_review_required` = attachment 已捕获，但当前 admitted lane 无法自动形成可信 answer-bearing body
  - `reference_only` = relation/provenance 应保留，但当前不主张存在 answer-bearing owner body
- 因此这两类不能被折叠成 `authoritative_attachment_missing`。
- `authoritative_attachment_missing` 只能用于“当前本应存在 authoritative owner，但 relation / bytes / child owner truth 尚未恢复”的 fail-close 场景。

### 5. `body_only_answerable` 必须是狭义例外，而不是对 missing owner 的宽松兜底

- future query contract 已明确：
  - `annual_cycle_rule`
  - `time_bound_operational_rule`
  打开 dedicated surface 之前，必须先有完整 metadata / query-planning / temporal filter contract。
- 这说明“notice body 提到了窗口或摘要”不等于“规则正文可以不看 attachment”。
- 因此 `body_only_answerable` 只应表示：
  - body 已经独立满足某个 unit 的最小 answer contract
  - 但这仍不足以把该 unit 直接提升为 future rule/service surface 的 canonical owner text

### 6. unresolved `file_release` owner 在本 phase 应统一收口到 `authority_pending`

- file-release readiness contract 已经证明：即使匹配逻辑存在，也仍会出现：
  - `missing_capture`
  - `missing_source_bytes`
  - `ambiguous_match`
- 当前 workstream non-goal 已明确不执行 file-release owner recovery。
- 所以对 derived unit 来说，最稳的 freeze 是：
  - `semantic_owner=authority_pending`
  - completeness / answerability 再决定是否 fail-close
  而不是假装 `file_release_document` 已经可消费。

### 7. 官方 metadata / versioning 术语支持“source notice / attachment / derived unit”继续分层

- DCMI `source` 把被描述资源定义为“derived from”上游资源。
- DCMI `hasPart` / `isPartOf` 把 related resource 的组成关系视为显式 relation，而不是彼此替身。
- DataCite Versioning 明确区分：
  - canonical resource
  - specific versions
  - version-to-version relation
- 基于这些官方资料的推断是：
  - wrapper notice、attachment owner、derived unit version 继续分层是合理的
  - 缺失 owner 时，正确动作是保留 relation / pending state，而不是让 wrapper text 静默替代 authoritative body

## Phase-3 Decisions To Freeze

1. authority / completeness / answerability 全部按 unit 判定，而不是按整条 notice 判定。
2. `attachment_document`、`notice_body`、`wrapper_notice`、`authority_pending` 继续是 root semantic owner family。
3. `attachments_declared` 来自 relation truth 与 owner expectations；`attachments_captured` 来自已恢复的 relation + owner outcome。
4. `manual_review_required` 与 `reference_only` 保持显式终态，不折叠进 missing-attachment。
5. `authoritative_attachment_missing` 只表达“应有的 authoritative owner 还未恢复出来”。
6. `body_only_answerable` 只允许窄范围 body-level answer，不允许冒充 future canonical owner text。
7. unresolved file-release-backed owner 继续归并到 `authority_pending`。

## Deferrals

- `Phase 4`
  - `default_agent`
  - `target_surface`
  - `body_only_answerable` 的 runtime adoption 规则
- `Phase 5`
  - exemplar walkthrough
  - adoption routing
  - verification closeout
- future implementation
  - projection builder
  - file-release owner recovery execution
  - runtime tool / query service 落地

## Risks If Mis-Scoped

- 如果按整条 notice 判 completeness，source notice 的 mixed-role 价值会消失。
- 如果把 `manual_review_required` / `reference_only` 当成 capture 缺失，后续 operator 与 runtime 都会误判 blocker 类型。
- 如果把 `body_only_answerable` 放宽成“只要 notice body 提过就能回答”，future rule/service surface 会继续被 wrapper notice 污染。
- 如果让 unresolved file-release owner 直接伪装成 `attachment_document` 或 `notice_body`，authority truth 会和当前 repo code/docs 冲突。

## Conclusions For Phase 3

1. `Phase 3` 的核心不是新增字段，而是为 `semantic_owner`、`completeness_status`、`answerability` 写出可执行的判定规则。
2. 这些规则必须复用 repo 已有的 attachment terminal outcome 与 owner-expectation truth。
3. 同一条 notice 必须允许同时产出：
   - body-level 可答 unit
   - attachment-backed fail-close unit
4. `Phase 4` 可以在此基础上继续讨论哪些状态进入 `notice-agent`、哪些状态继续留在 notice source / manual lane。
