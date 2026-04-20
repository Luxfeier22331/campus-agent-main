---
doc_type: phase_plan
phase: "1"
phase_name: "Agent And Tool Boundary Freeze"
status: planned
created: 2026-04-21
updated: 2026-04-21
---

# Phase 1 Plan

## Objective

冻结 `campus services / notices runtime admission` 的首条 execution boundary，让后续 `Phase 2-4` 可以直接围绕一组明确的 domain owner、tool slice、source matrix、temporal semantics 与 current/target label mapping 继续推进，而不是重复争论“这是不是 generic RAG”“是不是该先开 retrieval”“notice 到底来自哪条 source”。

## Why This Phase Exists

当前 repo 已经有：

- 产品定位和长期架构，明确把 campus service status / transport schedule / notice discovery 定义成独立 capability
- `supervisor -> specialist` 的现有 handoff 与 routing code path
- `service_catalog`、`internal_notice`、`fresh_news` 仍保持 `offline_preparation` 的 merged truth

当前 repo 还没有：

- `campus-services-agent` / `notice-agent` 的 current-truth boundary freeze
- 首发 `4` 个 tool 的 closed-set contract freeze
- `public notice-like pages` / `restricted internal notices` 的 source matrix freeze
- `current/latest/effective/current-year miss` 的 code-owned semantics
- current code labels 与 target planning labels 的显式 mapping

如果不先做这一步，后续 implementation 会在以下问题上持续漂移：

- 要不要直接从 retrieval alias 读 `service_catalog` / `internal_notice`
- “食堂营业时间”“公费医疗报销规则”“今天能不能办”到底归谁
- `campus_notice_discover/get` 到底是 public `official_web`、restricted `internal_notice`，还是两者一起
- 新 family 应该写进 `*-agent` 还是继续新增 `*-specialist`

## External References

- OpenAI, `A practical guide to building agents`
  - https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
- OpenAI docs, `Function calling`
  - https://platform.openai.com/docs/guides/function-calling
- OpenAI docs, `Tools`
  - https://platform.openai.com/docs/guides/tools
- OpenAI docs, `Evals design guide`
  - https://platform.openai.com/docs/guides/evals-design

## Locked Inputs

- 当前 merged truth query-enabled surface 不变：
  - `regulations/student_handbook`
  - `curriculum/curriculum_plan`
- `service_catalog`、`internal_notice`、`fresh_news` 继续保持 `offline_preparation`。
- 本 workstream 只处理 runtime admission，不 reopen `campus-services-offline-preparation-hardening`。
- `supervisor` 只负责 routing / terminal semantics，不直接拥有 domain tools。
- `transport_notice_latest` 与 `transport_pickup_point_lookup` 当前继续 deferred。
- repo-wide `*-specialist -> *-agent` label migration 属于独立 convergence workstream，不在本 phase 内实施。

## Decisions To Freeze

1. `campus-services-agent` 首发 owner 固定为：
   - `service_status_lookup`
   - `transport_schedule_lookup`
2. `notice-agent` 首发 owner 固定为：
   - `campus_notice_discover`
   - `campus_notice_get`
3. `navigation-agent` 继续只消费 transport/service point refs，不拥有 timetable truth 或 service-status truth。
4. `rag-specialist` 继续承接稳定制度/流程/材料类问答，例如公费医疗报销规则、所需材料、办理流程。
5. `campus_notice_discover/get` 的 scope 固定先按“notice task”而不是“retrieval collection”来定义；source matrix 需要显式区分 public notice-like pages 与 restricted internal notices。
6. “当前/最新/有效/今年”必须进入明确的 routing 和 contract 语义：
   - 不能靠 prompt 自猜
   - current-year miss 时只允许 explicit historical downgrade
7. `Phase 1` 只冻结 current-truth / target-truth label mapping，不执行 repo-wide rename：
   - code/contract current truth 仍可保留 `rag-specialist` / `navigation-specialist`
   - planning/target truth 可继续写 `campus-services-agent` / `notice-agent`
8. 未来的 internal query service 固定只能是 repo-owned projection query seam；不允许 `app-api` loopback HTTP、browser/public API 或 query-time raw scan。

## Execution Slices

### Slice 1: Freeze Capability Ownership Matrix

- 把五个 runtime owner 的边界写成 phase-local truth：
  - `supervisor`
  - `campus-services-agent`
  - `notice-agent`
  - `navigation-agent`
  - `rag-specialist`
- 明确“服务状态/临时关闭/班车安排”和“制度/流程/材料”之间的 split。
- 明确 `place_lookup` 仍是独立 navigation family，不被 `campus-services-agent` 吸收。

### Slice 2: Freeze Current-Truth And Target-Truth Labels

- 把当前 code/contract label 与 target planning label 并排写清：
  - current merged truth:
    - `rag-specialist`
    - `availability-specialist`
    - `navigation-specialist`
  - target-side planning truth:
    - `campus-services-agent`
    - `notice-agent`
    - `navigation-agent`
- 明确本 phase 的 deliverable 是 mapping 和 guardrails，不是 rename migration。
- 明确与 `execution-capability-family-convergence` 的边界，避免两条线互相覆盖。

### Slice 3: Freeze First Tool Surface And Deferred List

- 把首发 runtime surface 固定为闭集：
  - `service_status_lookup`
  - `transport_schedule_lookup`
  - `campus_notice_discover`
  - `campus_notice_get`
- 把显式 deferred 固定为：
  - `transport_notice_latest`
  - `transport_pickup_point_lookup`
- 明确不再扩成“顺手再加几个接近的工具”。

### Slice 4: Freeze Notice Source Matrix

- 明确 `campus_notice_discover/get` 处理的是 notice task，不是某个单一 retrieval collection。
- 明确至少存在两类上游 source family：
  - public `official_web` notice-like pages
  - restricted `campus_notices/internal_notice`
- 明确本 phase 不授权任何新 surface opening，只冻结 owner、routing 和 future contract 所需的 source split。
- 明确 `official_web/fresh_news` 的 freshness-sensitive retrieval 与 notice runtime 继续并列，不互相冒充。

### Slice 5: Freeze Temporal Semantics And Fail-Close

- 明确以下语义必须成为 code-owned truth，而不是 prompt heuristic：
  - `current`
  - `latest`
  - `effective`
  - `current-year miss`
  - `historical downgrade`
- 明确“今年无命中但往年有结果”时的 allowed behavior：
  - 只允许 explicit historical reference
  - 禁止把往年 notice 冒充成当前结果
- 明确“当前状态不可证实”时的 allowed behavior：
  - `service_status_lookup` / `transport_schedule_lookup` 必须 fail-close
  - 不允许自动回退 generic RAG 或 random notice answer

### Slice 6: Freeze Verification Gate For Phase 2

- 把 `Phase 2` 之前必须成立的 gate 写清：
  - tool set 是 closed set
  - source matrix 明确
  - temporal semantics 明确
  - current/target label mapping 明确
- 把当前可复用的 regression baseline 固定下来，避免 Phase 2 再重新找回归入口。

## Proposed Write Set For Later Execution

- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-1-agent-and-tool-boundary-freeze/CONTEXT.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-1-agent-and-tool-boundary-freeze/RESEARCH.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-1-agent-and-tool-boundary-freeze/PLAN.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/STATE.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/REQUIREMENTS.md`
- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/execution-and-specialists-architecture.md`
- `docs/architecture/official-web-serving-and-news-retrieval-strategy.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`

## Verification Matrix

- planning truth
  - `Phase 1` 目录下存在 `CONTEXT.md`、`RESEARCH.md`、`PLAN.md`
  - `STATE.md` 的 `Current Plan` 指向本 phase plan
- boundary truth
  - docs 明确区分 `campus-services-agent` / `notice-agent` / `navigation-agent` / `rag-specialist`
  - docs 明确 `supervisor` 不直接拥有这 `4` 个 domain tools
  - docs 明确 `transport_notice_latest` / `transport_pickup_point_lookup` 仍是 deferred
- surface truth
  - planning truth 不把 `service_catalog`、`internal_notice`、`fresh_news` 写成 query-enabled scope
  - planning truth 不把 `campus_notice_discover/get` 写成 generic retrieval alias
- temporal truth
  - current-year miss / historical downgrade / fail-close 规则有显式文档表达
  - “当前状态不可证”不会回退到 generic RAG 或 open-domain fallback
- regression truth
  - `uv run --all-packages python -m unittest tests.supervisor.test_supervisor_routing tests.supervisor.test_supervisor_query_policy tests.specialist.test_availability_specialist tests.specialist.test_navigation_specialist`
  - `uv run --all-packages python -m unittest tests.specialist.test_rag_specialist.RagSpecialistTest.test_official_web_no_evidence_uses_scope_specific_no_answer_copy tests.specialist.test_rag_specialist.RagSpecialistTest.test_official_web_freshness_sensitive_query_uses_scope_specific_fail_close_copy`

## Exit Rule

Phase 1 完成后，repo 应达到：

- 后续执行者不再需要重开“这是不是 generic RAG / retrieval opening / mega-tool bundle”这类边界争论
- `Phase 2` 可以直接围绕 strict schema、status enum、output shape 开始工作
- `Phase 3` 可以直接围绕 source-truth / normalized-truth lane 与 projection query seam 开始工作
- 这条线与 `execution-capability-family-convergence` 的关系已经写清，不会在 implementation 时继续混名
