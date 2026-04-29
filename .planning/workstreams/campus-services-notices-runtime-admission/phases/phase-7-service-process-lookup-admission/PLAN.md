---
doc_type: phase_plan
phase: "7"
phase_name: "Service Process Lookup Admission"
status: planned
created: 2026-04-21
updated: 2026-04-21
---

# Phase 7 Plan

## Objective

冻结 `service_process_lookup` 的 later-wave admission truth，让后续执行者明确知道：

- 哪些校园服务步骤 / 材料 / 入口问题未来可进入 `campus-services-agent` 的 structured runtime
- 哪些流程 / 制度 / 说明问题继续留在 `rag-specialist`
- `campus_services/service_catalog` 的 canonical process projection、related contact linkage、clarification 与 fail-close 应如何收口

## Why This Phase Exists

当前 repo 已经有：

- `service_catalog` taxonomy 与 runtime profile
- bounded hybrid service-navigation materialization
- handbook-derived process flow graph artifact
- `contact_directory_lookup` 与 stable-reference 的相邻边界

当前 repo 还没有：

- `service_process_lookup` 的 bounded tool contract
- service-process query 和制度/说明性 RAG 的明确边界
- process projection 的 canonical output / linkage / ambiguity semantics

如果不先做这一步，后续 execution 容易在以下问题上漂移：

- 把现有 `service_catalog` canonical markdown 误当成可以直接开的 query surface
- 办事步骤 / 材料 / 入口问题继续在 structured tool 与 generic RAG 之间摇摆
- 制度条款、材料要求和说明性正文被过度迁出 `rag-specialist`
- `contact_directory_lookup` / `service_process_lookup` / `service_status_lookup` 三类 service truth 重新混成一个大而模糊的 tool

## Locked Inputs

- owner family 固定保持 `campus-services-agent`
- `Phase 1-6` 已冻结 truth 不重开
- `service_catalog` 当前 runtime profile 继续保持：
  - `serving_stage = offline_preparation`
  - `retrieval_enabled = false`
  - `query_enabled_by_default = false`
- 本 phase 不把：
  - `contact_directory_lookup`
  - `service_status_lookup`
  - `official_web/stable_reference` opening
  - generic `service_catalog` retrieval rollout
  混进 `service_process_lookup`

## Decisions To Freeze

1. `service_process_lookup` 只承接 bounded service-process query class，例如：
   - 某校园服务怎么办理
   - 要准备哪些材料
   - 办理入口 / 提交流程 / 线下窗口或线上入口是什么
   - 某流程面向哪些人群或适用哪些前提
2. truth owner 固定为 `campus_services/service_catalog` 的 structured process projection。
   - handbook flow page、official-web 办事说明页、future service entry page 都只作为 source family / provenance 上游
   - runtime query 不直接回到 generic RAG chunk 或 raw source page
3. canonical projection/output 至少要能显式区分：
   - resolved service / process
   - applicable audience / preconditions
   - ordered steps
   - required materials
   - entry points / submission channels
   - related office / location refs
   - related contact refs
   - provenance / source refs
   - currentness / verification status
4. terminal semantics 固定为：
   - service / audience / process variant ambiguity -> `needs_clarification`
   - 缺 process graph、材料清单或入口 truth -> fail-close / unavailable
   - 不允许把弱匹配说明页或历史版本流程冒充 current canonical process
5. stable-RAG boundary 固定为：
   - 制度规则、解释性条款、一般 FAQ、跨服务政策说明继续留在 `rag-specialist`
   - 只有“服务边界明确且具备足够 normalized truth 的办理步骤 / 材料 / 入口问题”才可前向迁入 `service_process_lookup`
6. neighboring-tool boundary 固定为：
   - `contact_directory_lookup` 继续拥有 canonical contact truth
   - `service_status_lookup` 继续拥有 current-open/closed/override truth
   - `service_process_lookup` 只拥有步骤 / 材料 / 入口 / audience / prerequisite truth
7. 本 phase 只冻结 admission truth。
   - 不自动打开 product runtime lane
   - 不自动把 `service_catalog` runtime profile 切成 query-enabled

## Execution Slices

### Slice 1: Freeze Query Class Boundary

- 列出哪些流程问句进入 `service_process_lookup`
- 列出哪些相邻问句继续留在 `rag-specialist`

### Slice 2: Freeze Process Projection And Linkage Contract

- 定义 canonical process projection
- 定义与 contact/location/entry refs 的 linkage boundary

### Slice 3: Freeze Clarification And Fail-Close Semantics

- 明确 service ambiguity、audience ambiguity、多流程版本命中时的澄清规则
- 明确缺 structured process truth 时的 fail-close 规则

### Slice 4: Freeze Handbook / Stable-Reference / Regulation Boundary

- 明确 `student_rules`、`official_web/stable_reference` 与 `service_catalog` 的分工
- 避免把规则条款与说明性正文错误迁入 structured runtime

### Slice 5: Close Out This Workstream

- 在 `Phase 7` 完成后，把这条 workstream 从 active 推进到 completed truth

## Proposed Write Set

- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/ROADMAP.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/STATE.md`
- `.planning/WORKSTREAMS.md`

## Verification Matrix

- planning verification
  - `Phase 7` 目录下存在 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
  - `STATE.md` 的 `Current Phase` / `Current Plan` 与 `Phase 7` 一致
- source-truth verification
  - `configs/ingestion/campus_services/service_catalog/runtime-profile.json` 仍保持 `offline_preparation`
  - `tests.ingestion.test_corpus_runtime_profile` 继续证明 `retrieval_enabled = false` 与 `query_enabled_by_default = false`
- projection-shape verification
  - bounded hybrid materialization 继续保留 `flow-graph.json` / `canonical.md` / `document-units.jsonl`
  - current bounded slice 证明 process-oriented projection seam 已存在，但不等于 runtime lane 已打开
- future regression targets
  - `uv run --all-packages python -m unittest tests.ingestion.test_corpus_runtime_profile`
  - `uv run --all-packages python -m unittest tests.test_workspace_layout`

## Exit Rule

Phase 7 完成后，repo 应达到：

- `service_process_lookup` 的 bounded query class 已冻结
- `campus_services/service_catalog` 的 process-oriented truth owner / linkage / fail-close 语义已冻结
- `contact_directory_lookup` / `service_status_lookup` / `service_process_lookup` 三类 service truth 的分工已冻结
- 这条 runtime-admission workstream 可以完成 closeout，不再保留未决的 later-wave capability boundary 讨论
