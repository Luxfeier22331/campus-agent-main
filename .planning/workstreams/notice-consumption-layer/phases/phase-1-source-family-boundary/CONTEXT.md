---
phase: "1"
name: "Source Family Boundary"
created: 2026-04-21
updated: 2026-04-21
status: planned
---

# Phase 1 Context

**Gathered:** 2026-04-21
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责：

- 冻结 `source_notice`、`notice_attachment`、`derived consumption unit` 三层关系
- 冻结 `official_web_public_notice` 与 `internal_notice_restricted` 两个 notice source family 的边界
- 冻结 public notice runtime 与 `official_web/fresh_news` retrieval 的分工
- 冻结 restricted internal notice 在 consumption layer 中的姿态与 future query seam guardrail
- 为 `Phase 2` 的 derived-unit schema 和 `Phase 3` 的 authority / completeness contract 提供明确前提

它不负责：

- 直接实现新的 runtime tool、query service 或 UI
- reopen `official_web/fresh_news` / `news_archive`
- reopen restricted query-serving
- 冻结 derived unit 的正式字段 schema
- 冻结附件 authority、`attachments_declared != attachments_captured` 的 completeness 规则

</domain>

<current_truth>
## Current Truth

- 当前 shared contract 已冻结 `NoticeSourceFamily` 闭集：
  - `official_web_public_notice`
  - `internal_notice_restricted`
- `official_web` 长期允许同时供给 retrieval surface 与 structured notice runtime，但文档已明确：
  - `fresh_news` 是 freshness-sensitive retrieval surface
  - `notice-agent` 是显式 notice task runtime
  - 两者不是同一层，也不能互相冒充
- `campus_notices/internal_notice` 当前仍是 restricted、`offline_preparation`、`query_enabled_by_default=false` 的 source-channel-first triage collection
- authenticated notice source-truth contract 已冻结 canonical upstream unit 为稳定 `notice` 资源，而不是某次抓取结果、某个 retrieval alias、或某个下游 document/chunk
- 旧的 runtime admission workstream 已经冻结：
  - `campus_notice_discover/get` 必须显式区分 public notice family 与 restricted notice family
  - query seam 只能读 projection-backed notice metadata / canonical body truth
- 启动本 phase 之前，`notice consumption layer` workstream 只有 workstream-level `REQUIREMENTS.md`、`ROADMAP.md`、`STATE.md`，缺少 phase-local planning artifacts

</current_truth>

<decisions>
## Implementation Decisions

- **01-01:** `Phase 1` 的 owner 是 boundary freeze，不是 schema finalize，更不是 runtime opening。
- **01-02:** `source_notice` 继续是 canonical upstream unit；它不被 `fresh_news` document、`internal_notice` document、discovery card、canonical body projection 或 derived unit 替代。
- **01-03:** `notice_attachment` 继续保持 source-level relation truth；它既不自动等于独立消费单元，也不自动等于独立 document owner。
- **01-04:** `derived consumption unit` 固定是 `source_notice (+ optional attachment refs)` 的下游 typed projection；一条 `source_notice` 允许 fan-out 到多个 derived units，但每个 unit 只能有一个 `primary_role`。
- **01-05:** `Phase 1` 只接受两个 notice source family：
  - `official_web_public_notice`
  - `internal_notice_restricted`
  不新增第三个 family，也不把 `fresh_news` 单独升格成新的 notice source family。
- **01-06:** `official_web_public_notice` 表示“可进入 notice task routing 的 public notice-like page family”，不是整个 `official_web`，也不是整个 `fresh_news`。
- **01-07:** `internal_notice_restricted` 继续表示 restricted internal notice source family；当前只讨论它如何进入 consumption-layer modeling，不因此打开 query-serving，也不把它改写成 public notice 面。
- **01-08:** public notice runtime 与 freshness-sensitive news retrieval 必须继续分层：
  - `notice-agent` 处理“找通知/讲座/公示/结果/打开通知”这类显式 notice task
  - `fresh_news` 处理“最近发生了什么/最新新闻”这类 freshness-sensitive retrieval
- **01-09:** `Phase 1` 只冻结 role taxonomy 的边界和 admissible examples，不在本 phase 内冻结 derived unit 正式字段；字段 contract 留给 `Phase 2`。
- **01-10:** notice body、attachment body、wrapper text 的 authority / precedence，以及 `attachments_declared != attachments_captured` 时的 completeness / answerability，留给 `Phase 3`；本 phase 只明确这些问题不能被跳过。

</decisions>

<specifics>
## Specific Gaps

- 还没有正式写清 `official_web_public_notice` 与 `fresh_news` 的边界，导致 public notice 很容易被错误并回 generic news retrieval。
- 还没有正式写清 `internal_notice_restricted` 在 consumption layer 中是“restricted notice family”，而不是“query-disabled retrieval alias”。
- 还没有写清 `source_notice -> derived consumption unit` 的层次，所以 `annual_cycle_rule`、`notice_window`、`roster_publication`、`lecture_activity` 很容易继续被当成一个混合 notice 对象。
- exemplar notice 已暴露“同一通知既有窗口信息，也有附件里的规则正文”这一类多角色消费问题，但当前 planning 还缺第一层边界冻结。

</specifics>

<canonical_refs>
## Canonical References

- `docs/plans/archive/completed/notice-consumption-layer.md`
- `.planning/workstreams/notice-consumption-layer/REQUIREMENTS.md`
- `.planning/workstreams/notice-consumption-layer/ROADMAP.md`
- `.planning/workstreams/notice-consumption-layer/STATE.md`
- `packages/contracts/src/campus_contracts/models.py`
- `docs/architecture/current-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/domains/official-web/architecture.md`
- `docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice-source-truth-schema.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-1-agent-and-tool-boundary-freeze/CONTEXT.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-1-agent-and-tool-boundary-freeze/PLAN.md`

### Web Sanity-Check References

- `https://www.muc.edu.cn/xwzx.htm`
- `https://www.muc.edu.cn/tzgg.htm`

</canonical_refs>

<deferred>
## Deferred Follow-up

- `Phase 2`: derived consumption unit 的正式 schema、字段名、provenance 字段
- `Phase 3`: authority / completeness / answerability contract
- `Phase 4`: `notice-agent`、future `rag-agent`、`campus-services-agent` 的 handoff 规则
- `Phase 5`: worked example、adoption routing、verification closeout
- `official_web/fresh_news` / `news_archive` opening
- restricted runtime opening 或 auth-dependent capture

</deferred>
