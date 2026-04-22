---
phase: "2"
artifact: "research"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 2 Research

## Purpose

把 `Phase 2` 的 contract freeze 建立在两类事实之上：

- repo 当前 `packages/contracts` / `supervisor-core` 已存在的 typed seam 与 current-truth限制
- 最新官方 guidance 对“少量稳定 tools + strict schema + code-owned eval / policy”的支持

## Official References Consulted

- OpenAI, `A practical guide to building agents`
  - https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
- OpenAI docs, `Function calling`
  - https://platform.openai.com/docs/guides/function-calling
- OpenAI docs, `Tools`
  - https://platform.openai.com/docs/guides/tools
- OpenAI docs, `Structured outputs`
  - https://platform.openai.com/docs/guides/structured-outputs
- OpenAI docs, `Evals design guide`
  - https://platform.openai.com/docs/guides/evals-design

## Repo Pattern Readings

- `packages/contracts/src/campus_contracts/models.py`
- `packages/contracts/src/campus_contracts/__init__.py`
- `packages/supervisor-core/src/campus_supervisor_core/routing.py`
- `packages/supervisor-core/src/campus_supervisor_core/framing.py`
- `packages/supervisor-core/src/campus_supervisor_core/agent.py`
- `tests/supervisor/test_supervisor_routing.py`
- `tests/supervisor/test_supervisor_query_policy.py`
- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-1-agent-and-tool-boundary-freeze/PLAN.md`
- `docs/architecture/execution-and-agents-architecture.md`
- `docs/architecture/target-architecture.md`

## Standard Stack

- small, closed tool surface
  - 官方 agent guidance 继续支持先从少量、稳定、可验证的 tool 集开始，而不是把相近能力一次性扩成大而重叠的工具面。
  - 这直接支持本 workstream 继续把首发 surface 固定为 `4` 个 tool，不把 `transport_notice_latest`、`contact_directory_lookup` 等顺手混进来。
- strict schema over prompt convention
  - 官方 function calling / structured outputs guidance 继续强调 schema-first，而不是让 prompt 自行猜测参数形状或输出字段。
  - 这支持 `Phase 2` 把 temporal semantics、historical downgrade、fail-close result 写成 shared contract，而不是继续埋在 `answer_text` 里。
- code-owned tool control
  - 官方 tools guidance 继续支持由调用方显式控制可用工具子集。
  - 这与 repo 已冻结的方向一致：后续 `Phase 4` 应由 per-agent allowed-tools / handoff ownership 管住工具，不靠 prompt 提醒。
- eval against policy edges
  - 官方 evals guidance 继续强调对 tool selection、argument correctness、policy adherence 与 edge-case behaviors 做显式验证。
  - 对这条线而言，最该被 contract 化并验证的 edge cases 正是 `current/latest/effective`、current-year miss、historical downgrade 与 unavailable/unverifiable fail-close。

## Architecture Patterns

- tool schema should outlive label drift
  - 当前 current-truth 还是 `rag-specialist` / `availability-specialist` / `navigation-specialist`，但 forward planning truth 已引入 `campus-services-agent` / `notice-agent`。
  - 最稳的 contract 锚点是 tool identity，不是 family label。这样 future label migration 不会迫使 payload/result schema 改名重写。
- business outcome must not be overloaded onto delegate status
  - `DelegateStatus` / `SupervisorStatus` 更适合表达执行是否完成、是否需要澄清、是否报错。
  - “当前不可证”“只找到历史参考”“命中但已过期”“找到 notice body” 这类是 tool business outcome，必须单独建 enum。
- temporal semantics should be shared, not copied
  - `service_status_lookup`、`transport_schedule_lookup`、`campus_notice_discover` 都会消费时间语义，但它们的结果 shape 不同。
  - 最合理的冻结方式是：共享 temporal request vocabulary，共享少量 common metadata 字段，各 tool 拥有自己的 result model。
- discover/get must remain split
  - `campus_notice_discover` 适合返回 notice card / summary list / downgrade reason。
  - `campus_notice_get` 适合返回 canonical body / source refs / normalized metadata。
  - 如果一开始就混成单一 result union，后续 Phase 3-5 的 projection、eval、observability 都会失真。
- fail-close needs structured reasons
  - 这条线的核心不是“答得像不像”，而是“不该猜时能不能稳定不猜”。
  - 因此 fail-close 原因必须能被 contract 和 tests 直接观察，而不是只藏在中文文案里。

## Don't Hand-Roll

- 不要继续复用 `RagRequestPayload` 来承接这四个结构化 tool。
- 不要把时间条件继续塞回 `query_text` / `user_goal` 自由文本，指望后续 prompt 自己拆。
- 不要把 historical downgrade 退化成“answer_text 里提一句这是往年的”。
- 不要让 `campus_notice_get` 只返回 URL。
- 不要让 contract 名称直接绑定未完成的 `*-specialist -> *-agent` rename。

## Common Pitfalls

- enum 混层
  - 把 tool outcome、delegate status、supervisor terminal status 混成一个枚举，后续很难区分是业务 miss、需要澄清，还是执行失败。
- temporal drift
  - `current` / `latest` / `effective` / `as_of` 如果没有共享 vocabulary，不同 tool 很快会长出互不兼容的字段。
- result overloading
  - `discover` 与 `get` 如果共用结果 shape，最终会不是 “找列表” 也不是 “读正文”。
- provenance underspec
  - 如果不提前冻结 `source_family`、`source_url`、`published_at` / `effective_at`、related notice refs 一类字段，Phase 3 的 source matrix 会缺落点。

## Conclusions For Phase 2

1. `Phase 2` 应优先冻结 tool-local payload/result dataclass，而不是先碰 runtime wiring。
2. contract 应锚定在 `service_status_lookup`、`transport_schedule_lookup`、`campus_notice_discover`、`campus_notice_get` 这四个稳定 tool identity 上。
3. shared temporal semantics、historical downgrade 与 fail-close reason 必须成为 schema truth。
4. `Phase 3` 之前就应明确 `discover` / `get` 分离、tool outcome enum 分离、provenance field 分离，否则后续 source/projection 规划会持续空转。
