---
workstream: notice-consumption-layer
created: 2026-04-21
updated: 2026-04-25
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** Closeout
**Current Phase Name:** Operator Query And Closeout
**Current Plan:** `.planning/workstreams/notice-consumption-layer/phases/phase-8-operator-query-and-closeout/PLAN.md`
**Total Phases:** 8
**Total Plans in Phase:** 1
**Progress:** 8/8 phases complete
**Last Activity:** 2026-04-25
**Last Activity Description:** Completed manual-review downline for the
internal_notice consumption layer: new projection rows no longer emit
`consumption_status=manual_review_required`; machine-continuable legacy manual
promotion outcomes are routed to `pending_multimodal_processing`, hard
unsupported outcomes are routed to `no_adoption`, and operator gap audit now
reports processing states directly.

## Current Slice

- completed `Phase 1` artifacts:
  - context: `.planning/workstreams/notice-consumption-layer/phases/phase-1-source-family-boundary/CONTEXT.md`
  - research: `.planning/workstreams/notice-consumption-layer/phases/phase-1-source-family-boundary/RESEARCH.md`
  - plan: `.planning/workstreams/notice-consumption-layer/phases/phase-1-source-family-boundary/PLAN.md`
- completed `Phase 2` artifacts:
  - context: `.planning/workstreams/notice-consumption-layer/phases/phase-2-consumption-unit-schema/CONTEXT.md`
  - research: `.planning/workstreams/notice-consumption-layer/phases/phase-2-consumption-unit-schema/RESEARCH.md`
  - plan: `.planning/workstreams/notice-consumption-layer/phases/phase-2-consumption-unit-schema/PLAN.md`
- completed `Phase 3` artifacts:
  - context: `.planning/workstreams/notice-consumption-layer/phases/phase-3-authority-and-completeness/CONTEXT.md`
  - research: `.planning/workstreams/notice-consumption-layer/phases/phase-3-authority-and-completeness/RESEARCH.md`
  - plan: `.planning/workstreams/notice-consumption-layer/phases/phase-3-authority-and-completeness/PLAN.md`
- completed `Phase 4` artifacts:
  - context: `.planning/workstreams/notice-consumption-layer/phases/phase-4-agent-and-surface-handoff/CONTEXT.md`
  - research: `.planning/workstreams/notice-consumption-layer/phases/phase-4-agent-and-surface-handoff/RESEARCH.md`
  - plan: `.planning/workstreams/notice-consumption-layer/phases/phase-4-agent-and-surface-handoff/PLAN.md`
- completed `Phase 5` artifacts:
  - context: `.planning/workstreams/notice-consumption-layer/phases/phase-5-adoption-and-verification/CONTEXT.md`
  - research: `.planning/workstreams/notice-consumption-layer/phases/phase-5-adoption-and-verification/RESEARCH.md`
  - plan: `.planning/workstreams/notice-consumption-layer/phases/phase-5-adoption-and-verification/PLAN.md`
  - summary: `.planning/workstreams/notice-consumption-layer/phases/phase-5-adoption-and-verification/SUMMARY.md`
- completed `Phase 6` artifacts:
  - plan: `.planning/workstreams/notice-consumption-layer/phases/phase-6-projection-and-consumer-foundation/PLAN.md`
  - summary: `.planning/workstreams/notice-consumption-layer/phases/phase-6-projection-and-consumer-foundation/SUMMARY.md`
- completed `Phase 7` artifacts:
  - plan: `.planning/workstreams/notice-consumption-layer/phases/phase-7-non-regulation-derived-unit-coverage/PLAN.md`
  - summary: `.planning/workstreams/notice-consumption-layer/phases/phase-7-non-regulation-derived-unit-coverage/SUMMARY.md`
- completed `Phase 8` artifacts:
  - plan: `.planning/workstreams/notice-consumption-layer/phases/phase-8-operator-query-and-closeout/PLAN.md`
  - summary: `.planning/workstreams/notice-consumption-layer/phases/phase-8-operator-query-and-closeout/SUMMARY.md`

- preserved modeling truth:
  - `source_notice -> notice_attachment -> derived consumption unit` fan-out
    boundary 已冻结
  - public/restricted notice source family、authority / completeness /
    answerability 与 agent/surface handoff 已冻结
  - exemplar `关于启动2026届推荐优秀应届本科毕业生免试攻读研究生工作的通知`
    已写实 current-state / future-state 双路由
- adoption route 继续有效：
  - `attachment_rule_body` -> `authenticated-notice-regulation-consumption`
    -> `regulations/institutional_rules`
  - `annual_cycle_rule` / `time_bound_operational_rule`
    -> `authenticated-notice-regulation-consumption` -> `regulations/scoped_rules`
  - public-source `lecture_activity` / publication-like unit -> backlog
    `official-web-source-channel-news-opening`
  - `service_status_override` 与 `attachment_form_template` 只冻结 future
    adoption direction，不编造 native implementation workstream
- no-adoption truth 继续有效：
  - `internal_notice_restricted + roster_publication`
  - `internal_notice_restricted + lecture_activity`
  - 两者继续只保留 source-triage / provenance truth
- Phase 6 closeout：
  - repo-owned notice consumption projection shared model / in-memory store /
    Postgres store 已落地
  - `internal_notice_restricted` canonical rebuild path 已落地
  - `import_authenticated_notice_export` 已支持显式 projection rebuild seam
  - `regulations/institutional_rules` / `regulations/scoped_rules`
    materialization 已经通过 projection ready derived-unit truth 过滤 candidate
  - operator read-model 已能按 notice id 汇总 ready / held /
    pending_multimodal / legacy manual / no-adoption units
- Phase 7 closeout：
  - `procurement_notice` notice category 与 projection unit 已落地
  - internal restricted `roster_publication` / `lecture_activity` no-adoption
    projection truth 已落地
  - `service_status_override` projection candidate 已落地，target surface 为
    `campus_services/service_status_candidate`，但状态仍是
    `retained_for_notice_query`
  - `attachment_form_template` projection truth 已落地，target surface 为
    `notice_level_query`，状态仍是 `retained_for_notice_query`
- Phase 8 closeout：
  - operator/read-model status 可以按 notice id 汇总 ready / held /
    pending_multimodal / legacy manual / no-adoption units 与原因
  - explicit worker CLI `show_internal_notice_consumption_projection_status` 已落地
  - selected-notice rebuild 已改为 replace selected notices，避免局部 rebuild 留下
    stale projection units
  - `import_authenticated_notice_export` 可在 projection store / read-model store
    存在时为本次 imported notices 显式重建 internal_notice query read model
  - `packages/notice-agent` 已补 internal notice read-model backing query service，
    使用 PG/read-model repository + derived bucket canonical markdown body adapter，
    并保留 restricted authorization fail-close
  - `delegate_to_notice_agent(..., env=...)` 已能在未显式注入 fake/query service
    时，从 runtime env 构造 internal notice discover/get backing query service；
    配置缺失时继续返回 `internal_query_service_unavailable`
  - 2026-04-24 local read-model storage closeout：
    - read model entry 增加 `body_excerpt`，默认上限 `800` chars
    - `search_text` 默认上限 `2000` chars，不再承载完整 canonical markdown body
    - `record jsonb` 只复制 bounded read-model payload，不复制完整正文
    - rebuild worker report 输出 observed/max excerpt 与 search_text 字符数，用于本地容量检查
    - `supervisor-api` notice PG store 显式限制本地 pool 为 `min=0 / max=2`
  - 2026-04-25 correction：
    - 已纠正 local execution 口径：不能把 source-truth inventory 全量扫入 PG
      projection/read model，只有显式经过 consumer layer 选择处理的 notice 才能落库
    - persistent `rebuild_internal_notice_consumption_projection` core path 与
      CLI 现在拒绝不带 `--notice-id`/`--document-id` 的 implicit full-scope
      rebuild
    - 本地误写的 `campus_notices/internal_notice` projection scope 已清空；read
      model 未写入
  - 2026-04-25 closeout supplement：
    - `CampusNoticeDiscoverPayload` 与 Go structured query runtime 已支持
      `target_surfaces`，可显式过滤 `procurement_notice_history` 等 queryable
      read-model surface
    - 新增 `check_internal_notice_read_model_consistency` worker CLI，用于只读
      比对 consumption projection 与 read model，报告 queryable projection
      missing rows 与 read-model extra rows
  - 2026-04-25 manual-review downline：
    - 新生成的 consumption projection 不再产出
      `consumption_status=manual_review_required`
    - legacy `manual_review_required` promotion action 若仍可机器继续处理，转为
      `target_surface=multimodal_processing_candidate` 与
      `consumption_status=pending_multimodal_processing`
    - `input_lane_not_admitted` / `draft_signal_detected` /
      `unsupported_revision_track` 等硬性不采纳 reason 转为
      `target_surface=unsupported` 与 `consumption_status=no_adoption`
    - status/report worker 增加 pending multimodal count，同时保留 legacy manual
      count 用于历史数据暴露
    - 新增 `check_internal_notice_processing_gaps` worker CLI，按 selected notices
      汇总 pending multimodal、authority pending、unsupported、no adoption、ready
      与 retained 状态
  - 2026-04-25 multimodal closeout：
    - 新增 `process_internal_notice_pending_multimodal_entries` core path 与
      `process_internal_notice_multimodal` worker CLI
    - worker 默认只接受 `--notice-id` / `--selection-path`，拒绝 implicit
      full-scope multimodal processing
    - provider 连接复用 env chat endpoint：优先读取
      `INTERNAL_NOTICE_MULTIMODAL_*`，否则继承 `PROMPT_RUNTIME_*` / `LLM_*`
    - 处理结果只允许把 pending unit 关闭为 notice-level
      `retained_for_notice_query` 或 `no_adoption`；需要更多处理时继续保留
      pending，不直接升格为 regulation target
    - read model 现在会把 `multimodal_summary` /
      `multimodal_extracted_text` 纳入 bounded excerpt/search text
- Semantic split closeout：
  - `notice_runtime` 不再作为新写入 projection target/status 语义
  - notice-level query 候选写入 `target_surface=notice_level_query`
  - procurement 历史通知写入 `target_surface=procurement_notice_history`
  - internal restricted no-adoption 写入 `target_surface=unsupported`
  - `held_in_notice_runtime` 保留为旧常量名兼容 alias；新状态值为
    `retained_for_notice_query`

## Blockers

- 无外部 blocker。
- Closeout 后约束：
  - 不在本轮重开 query-serving 或 runtime opening
  - 不把 procurement / lecture / roster 这类 future/non-adopted family 混进
    regulation target hardening
  - 不把 service-status 或 form-template candidate 升格成 campus-services runtime /
    document-center rollout
  - `authenticated-notice-regulation-consumption` 仍只负责 target-side hardening，
    不承接 generic middle-layer truth

## Verification

- Targeted implementation tests 已补：
  - projection store / builder 单元测试
  - import projection rebuild seam 测试
  - import read-model rebuild seam 测试
  - internal notice read-model builder/store/worker 测试
  - notice-agent read-model backing query service 测试
  - notice-agent default runtime wiring 测试
  - `internal_notice` institutional materialization projection ready gate 测试
  - explicit rebuild worker CLI 测试
  - operator status worker CLI 测试
  - procurement/no-adoption/service-status/form-template projection unit 测试
  - read-model consistency checker / worker CLI 测试
  - notice discover target surface facet 测试
  - manual-review downline projection / status / rebuild report / processing gap
    checker 测试
- planning verification:
  - `git diff --check -- ...notice-consumption-layer...`

## Session Continuity

**Stopped At:** `notice-consumption-layer` implementation closeout complete for
internal_notice.
**Resume File:** `.planning/workstreams/notice-consumption-layer/STATE.md`
