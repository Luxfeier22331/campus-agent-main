---
phase: "4"
name: "Agent And Surface Handoff"
created: 2026-04-21
updated: 2026-04-21
status: planned
---

# Phase 4 Context

**Gathered:** 2026-04-21
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责：

- 冻结 `default_agent` 与 `target_surface` 如何消费 `Phase 3` 的 authority / completeness / answerability truth
- 冻结哪些 units 继续停留在 `notice_runtime`
- 冻结哪些 units 只是 future `rag-agent` / `campus-services-agent` adoption candidate
- 冻结 `publication_surface_candidate` 的当前解释
- 为 `Phase 5` 的 worked example 与 adoption routing 提供稳定输入

它不负责：

- 重开 runtime capability family、tool contract 或 supervisor wiring
- 直接打开 `notice-agent`、`campus-services-agent`、`rag-agent` 新 query path
- 实现新的 projection、query service、tool adapter 或 UI
- 重开 `Phase 3` 的 owner / completeness / answerability 规则
- admission 新的 dedicated publication runtime

</domain>

<current_truth>
## Current Truth

- `Phase 1` 已冻结：
  - admitted source family 闭集
  - public notice runtime / restricted notice runtime / `fresh_news` retrieval 分层
- `Phase 2` 已冻结：
  - `default_agent`
  - `target_surface`
  只是 hint，不是 opened-surface truth
- `Phase 3` 已冻结：
  - `semantic_owner`
  - `completeness_status`
  - `answerability`
  的 derivation rule
- 旧的 `campus-services / notices runtime admission` workstream 已关闭，并把以下 runtime truth 冻结为 completed plan：
  - `notice-agent`
    - `campus_notice_discover`
    - `campus_notice_get`
  - `campus-services-agent`
    - `service_status_lookup`
    - `transport_schedule_lookup`
  - `rag-agent`
    - 当前仍是默认 retrieval-oriented stable knowledge owner
- execution / retrieval architecture 已冻结：
  - `notice-agent` 只消费 notice discovery / canonical notice body projection
  - `campus-services-agent` 只消费 structured service truth projection
  - `rag-agent` 不回收显式 notice runtime task
  - structured runtime surface 与 retrieval surface 可以并存，但不能互相冒充
- ADR-0036 / ADR-0037 已冻结：
  - `annual_cycle_rule`
  - `time_bound_operational_rule`
  不进入 `regulations/institutional_rules`
  - 它们的 holding target 是 `regulations/scoped_rules`
  - `regulations/scoped_rules` 当前仍是 `offline_preparation + query_disabled`

</current_truth>

<decisions>
## Implementation Decisions

- **04-01:** `default_agent` 与 `target_surface` 的 handoff 继续是 derived-unit adoption hint，而不是 runtime opening truth。
- **04-02:** 所有显式 notice task 的第一入口继续固定为 `notice-agent`：
  - `campus_notice_discover`
  - `campus_notice_get`
  这条规则不因 unit 未来可能进入其他 surface 而改变。
- **04-03:** `notice_runtime` 固定是 notice-derived units 的默认 holding surface；除非某个 unit 同时满足更严格的 downstream adoption 条件，否则它继续留在 `notice-agent` / notice projection lane。
- **04-04:** 只有同时满足以下条件的 unit，才允许把 `default_agent` 从 `notice-agent` 切向 future `rag-agent` 或 `campus-services-agent`：
  - `semantic_owner` 不再是 `wrapper_notice` / `authority_pending`
  - `completeness_status=complete`
  - `answerability=answerable`
  - target surface 的 collection/runtime boundary 已经与该 `primary_role` 相容
- **04-05:** 以下状态固定不得 handoff 给 future `rag-agent` 或 `campus-services-agent` 作为 canonical owner truth：
  - `body_only_answerable`
  - `manual_review_required`
  - `reference_only`
  - `not_answerable`
- **04-06:** `body_only_answerable` 固定继续留在 `notice_runtime`；它最多支持 notice-runtime explanation，不得直接推进到 `regulations/*` 或 `service_status_runtime`。
- **04-07:** `target_surface=regulations/institutional_rules` 只保留给稳定 formal rule body；`annual_cycle_rule` 与 `time_bound_operational_rule` 固定不进入这里。
- **04-08:** `target_surface=regulations/scoped_rules` 固定承接：
  - `annual_cycle_rule`
  - `time_bound_operational_rule`
  但只有在 unit 已 `complete + answerable` 时，`default_agent` 才允许转成 future `rag-agent` candidate；否则继续停在 `notice-agent`。
- **04-09:** `target_surface=service_status_runtime` 只允许承接：
  - `service_status_override`
  - 或已被显式收口为 current-effective service truth 的 `time_bound_operational_rule`
  且要求 `complete + answerable`；否则不得交给 `campus-services-agent`。
- **04-10:** `target_surface=publication_surface_candidate` 只表示“future public-facing publication/news adoption hint”：
  - 对 `official_web_public_notice` 的 `lecture_activity` 或其他 public publication-like unit，可保留这类 hint
  - 对 `internal_notice_restricted` 的 `lecture_activity` / `roster_publication`，当前仍不构成已 admission 的产品消费候选；它们继续停在 source-triage / provenance truth
  - 在 dedicated publication runtime 出现前，所有仍可见的 publication-like unit 的 `default_agent` 继续保持 `notice-agent`
- **04-11:** `notice_window` 与 `attachment_form_template` 第一版默认继续由 `notice-agent` 持有：
  - `notice_window` -> `notice_runtime`
  - `attachment_form_template` -> `notice_runtime`
  不因与规则/服务问题相关而直接切给别的 agent。
- **04-12:** `attachment_rule_body` 的 downstream target 由 semantic nature 决定：
  - 稳定 formal rule body -> `regulations/institutional_rules`
  - annual / time-bound scoped rule body -> `regulations/scoped_rules`
  但两种情况都要求 `complete + answerable`，否则继续停在 notice lane。
- **04-13:** `internal_notice_restricted` 与 `official_web_public_notice` 共享同一 semantic handoff contract，但不共享 opening posture；restricted family 的 query path 是否可用仍需单独 admission。
- **04-14:** future `rag-agent` / `campus-services-agent` 只能消费 repo-owned downstream projection，不得直接读取 raw notice/source bundle 或把 `campus_notice_get` 当作 owner query seam。

</decisions>

<specifics>
## Specific Gaps

- 还没有正式写清 `default_agent=notice-agent` 何时只是默认 holding owner、何时才允许切向下游 semantic owner surface。
- 还没有正式写清 `service_status_override` 与 `time_bound_operational_rule` 之间的 handoff 条件。
- 还没有正式写清 `publication_surface_candidate` 在 dedicated runtime 缺席时的当前解释。
- exemplar notice 仍缺一份明确的 agent/surface mapping，用来证明 mixed outcome 不会把所有 unit 都塞回 `rag-agent` 或 `notice-agent` 单一路径。

</specifics>

<canonical_refs>
## Canonical References

- `docs/plans/archive/completed/notice-consumption-layer.md`
- `.planning/workstreams/notice-consumption-layer/REQUIREMENTS.md`
- `.planning/workstreams/notice-consumption-layer/ROADMAP.md`
- `.planning/workstreams/notice-consumption-layer/STATE.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-2-consumption-unit-schema/CONTEXT.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-2-consumption-unit-schema/RESEARCH.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-2-consumption-unit-schema/PLAN.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-3-authority-and-completeness/CONTEXT.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-3-authority-and-completeness/RESEARCH.md`
- `.planning/workstreams/notice-consumption-layer/phases/phase-3-authority-and-completeness/PLAN.md`
- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`
- `docs/architecture/execution-and-agents-architecture.md`
- `docs/architecture/retrieval-serving-architecture.md`
- `docs/architecture/official-web-serving-and-news-retrieval-strategy.md`
- `docs/decisions/adr-0036-notice-derived-non-regulation-rule-boundary.md`
- `docs/decisions/adr-0037-unified-scoped-rules-holding-collection.md`
- `docs/reference/internal-notice-manual-review-future-query-contract.md`
- `packages/notice-agent/README.md`
- `packages/supervisor-core/README.md`

</canonical_refs>

<deferred>
## Deferred Follow-up

- `Phase 5`
  - worked example
  - adoption routing
  - verification closeout
- future runtime work
  - actual projection implementation
  - query service adoption
  - publication runtime admission
  - restricted notice runtime opening

</deferred>
