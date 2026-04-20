---
phase: "1"
artifact: "research"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 1 Research

## Purpose

把 `Phase 1` 的边界冻结建立在两类事实之上：

- repo 当前已经存在的 `supervisor -> specialist` handoff、runtime profile、notice/source split 与 fail-close posture
- 最新官方 agent/tool guidance 对“manager + specialized agent + strict tool contract + eval-first”这条路径的支持

## Official References Consulted

- OpenAI, `A practical guide to building agents`
  - https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
- OpenAI docs, `Function calling`
  - https://platform.openai.com/docs/guides/function-calling
- OpenAI docs, `Tools`
  - https://platform.openai.com/docs/guides/tools
- OpenAI docs, `Evals design guide`
  - https://platform.openai.com/docs/guides/evals-design

## Repo Pattern Readings

- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/REQUIREMENTS.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/ROADMAP.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/STATE.md`
- `docs/architecture/product-positioning.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/execution-and-specialists-architecture.md`
- `docs/architecture/agentic-retrieval-architecture.md`
- `docs/architecture/official-web-serving-and-news-retrieval-strategy.md`
- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `configs/ingestion/campus_services/service_catalog/runtime-profile.json`
- `configs/ingestion/campus_notices/internal_notice/runtime-profile.json`
- `configs/ingestion/official_web/fresh_news/runtime-profile.json`
- `packages/contracts/src/campus_contracts/models.py`
- `packages/supervisor-core/src/campus_supervisor_core/routing.py`
- `packages/supervisor-core/src/campus_supervisor_core/framing.py`
- `packages/supervisor-core/src/campus_supervisor_core/agent.py`
- `tests/supervisor/test_supervisor_routing.py`
- `tests/supervisor/test_supervisor_query_policy.py`
- `tests/specialist/test_rag_specialist.py`
- `docs/plans/execution-capability-family-convergence.md`

## Standard Stack

- manager-led orchestration
  - OpenAI 的 agent guidance 继续支持“一个 manager / supervisor 做 routing，把稳定子任务交给更窄的 agent 或 tool”这种形态。
  - 这与 repo 当前 `supervisor` 负责 routing / terminal semantics、domain capability 负责执行边界的长期设计一致。
- strict tool contract
  - OpenAI 官方 function-calling guidance 继续强调用 schema 明确 tool inputs/outputs，而不是让 prompt 自己猜参数形状。
  - 这直接支持 `Phase 2` 之后把 `service_status_lookup`、`transport_schedule_lookup`、`campus_notice_discover`、`campus_notice_get` 收口成 strict payload/result contract。
- allowed-tools as code-owned enforcement
  - OpenAI tools guidance 支持在每次请求里控制可用工具子集。
  - 这与 repo 已写入 `Phase 4` 的 `per-agent allowed_tools` 方向一致，也说明“靠 prompt 约定不要乱用工具”不够。
- eval-first runtime admission
  - OpenAI evals guidance 继续建议先把 tool selection、argument correctness、policy adherence、edge-case fail-close 做成显式评估。
  - 这与本 workstream 把 `current/latest/effective`、historical downgrade、fail-close 写成 phase gate 的方向一致。

## Architecture Patterns

- structured runtime is not generic retrieval
  - repo 已冻结 `service_status_lookup`、`transport_schedule_lookup`、`campus_notice_discover/get` 不属于 generic retrieval path。
  - 官方 agent guidance 也支持把高度结构化、需要明确动作边界的问题拆成专门 capability，而不是混成一个大知识工具。
- thin adapter over repo-owned truth
  - 最稳的形态不是 browser-facing API 回环，也不是 query-time raw scan，而是 `internal query service -> thin tool adapter -> domain agent`。
  - 这让 prompt/runtime 只处理 routing 与 answer shaping，不让 tool 自己变成 truth owner。
- temporal semantics must be first-class
  - `current/latest/effective`、current-year miss、historical downgrade 这类语义不能继续压在 answer wording 上补救。
  - 应该在 routing / tool contract / projection filter 阶段就冻结成 code-owned semantics。
- source matrix must be explicit
  - public `official_web` notice-like pages 与 restricted `campus_notices/internal_notice` 不是同一层。
  - `notice-agent` 可以长期同时消费多个 notice-like source family，但 `Phase 1` 必须先冻结它们的 owner split 与 routing split。
- terminology freeze must stay decoupled
  - 当前 code/contract 还是 `*-specialist`，planning/target truth 已开始用 `*-agent`。
  - 这条线应在 `Phase 1` 里显式写 current/target mapping，但不能顺手扩大成 repo-wide label migration；那是独立 convergence workstream 的职责。

## Don't Hand-Roll

- 不要把 `campus_services/*` 或 `internal_notice` 因为 runtime admission 就写成 query-enabled retrieval surface。
- 不要把 `campus_notice_get` 退化成“只返回 URL 或 raw notice snippet”。
- 不要让 `rag-specialist` 重新吸收运营状态、班车班次或 canonical notice reading。
- 不要把 `navigation-agent` 扩回 timetable truth / service-status truth owner。
- 不要通过 `app-api` loopback HTTP、browser API 或 raw source scan 来伪造“internal query service”。
- 不要在 `Phase 1` 就把 repo 全量 `*-specialist` 命名迁移到 `*-agent`。

## Common Pitfalls

- label drift
  - planning 写 `campus-services-agent`，代码仍只有 `availability-specialist` / `navigation-specialist` / `rag-specialist`；如果不先写 mapping，很快会出现文档 truth 与 contract enum 双漂移。
- source ambiguity
  - “通知”既可能来自 `official_web` notice-like public pages，也可能来自 `internal_notice` restricted triage collection；如果 Phase 1 不先区分，Phase 2 会把 discover/get schema 写成空壳。
- temporal ambiguity
  - “今天”“最新”“本学期”“2026 春假”这类时间条件如果不在 contract 层显式化，就会被 prompt 或 retrieval 层偷偷猜测。
- scope reopening by accident
  - `service_catalog`、`internal_notice`、`fresh_news` 现在都是 `offline_preparation`；最容易腐烂的写法是为了尽快跑通，直接从 retrieval path 读 alias。
- false coupling with navigation launch
  - 当前 top-level `place_lookup` 仍 fail-close，不代表 `navigation-agent` 失效；只是产品主路径还没恢复导航 opening。
  - `campus-services-agent` 与 `notice-agent` 的 boundary freeze 不应被地图 rollout blocker 挟持。

## Conclusions For Phase 1

1. `Phase 1` 应先冻结 capability boundary、tool slice、source matrix、temporal semantics，不先写 payload/model code。
2. `supervisor` 继续做 manager / router；domain agent 才拥有对应工具，工具后面是 repo-owned query truth。
3. current-truth `*-specialist` 与 target-truth `*-agent` 必须并排写清，不在本 phase 内做 repo-wide rename。
4. `campus_notice_discover/get` 需要显式区分 public notice-like pages 与 restricted internal notices；否则后续 schema 和 opening gate 无法收口。
5. `Phase 5` 的验证不该从 UI smoke 起步，而应先覆盖 routing correctness、tool selection、temporal fail-close 与 historical downgrade。
