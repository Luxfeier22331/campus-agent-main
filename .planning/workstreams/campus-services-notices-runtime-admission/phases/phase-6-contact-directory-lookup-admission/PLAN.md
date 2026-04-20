---
doc_type: phase_plan
phase: "6"
phase_name: "Contact Directory Lookup Admission"
status: planned
created: 2026-04-21
updated: 2026-04-21
---

# Phase 6 Plan

## Objective

冻结 `contact_directory_lookup` 的 later-wave admission truth，让后续执行者明确知道：

- 哪些联系方式问句属于 `campus-services-agent` 的 bounded structured runtime
- 哪些问题继续留在 `official_web/stable_reference` / `rag-specialist`
- `campus_services/contact_directory` 的 canonical query projection、provenance、clarification 与 fail-close 应如何收口

## Why This Phase Exists

当前 repo 已经有：

- `contact_directory` taxonomy 与 runtime profile
- handbook / official-web contact-like page 的 projection / cleaning 基础
- `campus-services-agent` 的 later-wave capability direction

当前 repo 还没有：

- `contact_directory_lookup` 的 bounded tool contract
- 联系方式问题和 stable-reference RAG 的明确边界
- structured contact projection 的 canonical output / provenance / ambiguity 口径

如果不先做这一步，后续 execution 容易在以下问题上漂移：

- 联系方式问句继续在 generic RAG 与 future structured tool 之间来回摇摆
- 整页 roster / directory chunk 被错误当成 runtime contact answer
- official-web 稳定说明页与 `contact_directory` semantic-owner truth 被混成同一层
- 弱匹配的历史电话、部门名或联系人名被误当成 current canonical contact

## Locked Inputs

- owner family 固定保持 `campus-services-agent`
- `Phase 1-5` 已冻结 truth 不重开
- `contact_directory` 当前 runtime profile 继续保持：
  - `serving_stage = offline_preparation`
  - `retrieval_enabled = false`
  - `query_enabled_by_default = false`
- 本 phase 不把：
  - `service_process_lookup`
  - `service_status_lookup`
  - `official_web/stable_reference` opening
  混进 `contact_directory_lookup`

## Decisions To Freeze

1. `contact_directory_lookup` 只承接 bounded contact-finding query class，例如：
   - 某部门电话 / 邮箱 / 办公地点
   - 某办公室 / 某岗位 / 某联系人联系方式
   - 不承接办事流程、材料要求、制度解释或营业状态
2. truth owner 固定为 `campus_services/contact_directory` 的 structured projection。
   - handbook 电话页、official-web 联系方式页、未来目录页都只作为 source family / provenance 上游
   - runtime query 不直接回到 generic RAG chunk 或 raw source page
3. canonical projection/output 至少要能显式区分：
   - resolved entity / entity group
   - entity type
   - display label
   - organization / department
   - role / title
   - contact methods
   - office / campus location
   - provenance / source refs
   - currentness / verification status
4. terminal semantics 固定为：
   - multi-match / alias ambiguity -> `needs_clarification`
   - 缺 canonical current contact truth -> fail-close / unavailable
   - 不允许把历史/弱匹配联系方式冒充 current answer
5. stable-reference RAG boundary 固定为：
   - 机构介绍、院系说明、办事说明、FAQ、长期文本说明继续可留在 `official_web/stable_reference` / `rag-specialist`
   - 但明确的 contact fact lookup 不再作为 generic RAG 长期 owner
6. 本 phase 只冻结 admission truth。
   - 不自动打开 product runtime lane
   - 不自动把 `contact_directory` runtime profile 切成 query-enabled

## Execution Slices

### Slice 1: Freeze Query Class Boundary

- 列出哪些 user intents 进入 `contact_directory_lookup`
- 列出哪些相邻 intents 继续留在 `rag-specialist` 或其他 later-wave tool

### Slice 2: Freeze Projection And Provenance Contract

- 定义 canonical contact entity / entity-group query projection
- 定义最小 provenance / source-family fields

### Slice 3: Freeze Clarification And Fail-Close Semantics

- 明确 alias ambiguity、多联系人、多部门命中时的澄清规则
- 明确 currentness 不可证、directory 缺项、source 冲突时的 fail-close 规则

### Slice 4: Freeze Stable-Reference Boundary

- 明确 `official_web/stable_reference` 与 `contact_directory_lookup` 的分工
- 避免把联系方式长期继续留给 generic RAG 兜底

### Slice 5: Prepare Later Implementation Handoff

- 为后续 shared contract、query service seam、routing / eval 提供明确 write target

## Proposed Write Set

- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`
- `docs/architecture/execution-and-specialists-architecture.md`
- `docs/architecture/retrieval-serving-architecture.md`
- `docs/architecture/official-web-serving-and-news-retrieval-strategy.md`
- `docs/reference/runtime-serving-and-index-terms.md`
- `packages/contracts/src/campus_contracts/models.py`
- `packages/contracts/src/campus_contracts/__init__.py`
- `tests/contracts/test_models.py`
- `tests/supervisor/test_supervisor_routing.py`

## Verification Matrix

- planning verification
  - `Phase 6` 目录下存在 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
  - `STATE.md` 的 `Current Plan` 指向 `Phase 6`
- source-truth verification
  - `configs/ingestion/campus_services/contact_directory/runtime-profile.json` 仍保持 `offline_preparation`
  - `tests.ingestion.test_corpus_runtime_profile` 继续证明 `retrieval_enabled = false` 与 `query_enabled_by_default = false`
- boundary verification
  - `ADR-0005` 继续把 `contact_directory` 定义为 `campus_services` semantic-owner collection
  - `official_web` 架构文档继续把联系方式说明页保留在 `stable_reference`，而不是自动等同 structured contact tool
- future regression targets
  - `uv run --all-packages python -m unittest tests.ingestion.test_corpus_runtime_profile`
  - `uv run --all-packages python -m unittest tests.contracts.test_models`
  - `uv run --all-packages python -m unittest tests.supervisor.test_supervisor_routing`

## Exit Rule

Phase 6 完成后，repo 应达到：

- `contact_directory_lookup` 的 bounded query class 已冻结
- `campus_services/contact_directory` 的 truth owner / projection / provenance / fail-close 语义已冻结
- 后续执行者可以直接围绕 shared contract + implementation seam 推进，而不再重开“联系方式问题到底归 structured runtime 还是 generic RAG”讨论
