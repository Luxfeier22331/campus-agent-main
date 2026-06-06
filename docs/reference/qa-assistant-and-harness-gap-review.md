---
doc_type: reference
status: active
created: 2026-04-24
updated: 2026-04-26
---

# QA Assistant And Harness Gap Review

本文记录 2026-04-24 对问答助手与产品级 QA harness 的 gap review。

它只登记已识别问题、证据与后续任务映射，不改写当前
accepted merged truth，也不把 deferred / backlog 能力冒充为已上线。

## Review Inputs

外部参考：

- OpenAI Harness Engineering:
  <https://openai.com/index/harness-engineering/>
- OpenAI agents integrations and observability:
  <https://developers.openai.com/api/docs/guides/agents/integrations-observability>
- OpenAI agents guardrails and human review:
  <https://developers.openai.com/api/docs/guides/agents/guardrails-approvals>
- OpenAI agents orchestration and handoffs:
  <https://developers.openai.com/api/docs/guides/agents/orchestration>
- OpenAI evaluate agent workflows:
  <https://developers.openai.com/api/docs/guides/agent-evals>
- OpenAI evaluation best practices:
  <https://developers.openai.com/api/docs/guides/evaluation-best-practices>

本地参考：

- `docs/architecture/current-architecture.md`
- `docs/architecture/target-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/system/operator-observability-architecture.md`
- `docs/architecture/system/prompt-and-instruction-architecture.md`
- `docs/reference/eval-gold-truth-model.md`
- `docs/reference/eval-benchmark-artifact-contract.md`
- `.planning/PROJECT.md`
- `.planning/WORKSTREAMS.md`

## Summary

当前方向正确：产品问答仍应保持
`public-chat-web -> app-api -> execution-gateway -> supervisor-agent-worker -> agent`
的 supervisor-led 主链路。这里讨论的 harness 指校园问答助手产品自身的
quality harness：eval、trace、guardrail、review 与 badcase 回流闭环；
它不是 repo-owned workstream execution harness。

主要缺陷集中在两类：

- 问答助手仍是受控知识问答子集，尚未完整覆盖真实校园助理目标态。
- 问答助手已经有部分 release gate / deterministic eval 证据，但还没有形成
  完整的产品级 agent quality harness。

## Eval And Observability Prerequisites

产品级 QA harness 不应先于 eval / observability 的基础缺口落地。
当前更合理的顺序是：

1. 先补齐 eval governance。
2. 再补齐 answer replay / badcase / grading 所需的 observability 前置能力。
3. 最后再定义 QA harness contract，把 eval 与 observability 串成闭环。

当前 eval 已有 shared runtime、artifact contract、publish/backflow seam 与
release-gate automation。主要缺口仍是 `Phase 5`：

- coverage matrix / denominator truth 尚未正式治理
- retrieval qrels shared governance 尚未完成
- workflow/status case governance 尚未完成
- deterministic answer truth governance 尚未完成
- synthetic candidate intake governance 尚未完成

后续任务：

- `.planning/todos/pending/2026-04-24-complete-eval-governance-prereqs.md`

当前 operator observability 已完成 request projection、Quality / Safety /
Cost / Audit panel domains、badcase queue、sampled grade backflow 与真实
staging/sink evidence。它的剩余缺口不是“没有观测面”，而是还需要面向
QA harness 前置确认：

- answer replay 所需字段是否能跨 app-api、supervisor、rag-agent、
  retrieval activity 稳定关联
- badcase queue 是否能稳定携带 route / handoff / guardrail / evidence 归因
- sampled grading 输出是否足够支撑 eval candidate intake
- structured runtime / future agentic retrieval 的 summary 字段是否已有
  fail-close 与 business outcome 语义
- trace / issue backlink 是否能支撑 operator 从坏例追到可回归 case

后续任务：

- `.planning/todos/pending/2026-04-24-audit-observability-qa-prereqs.md`

## App API First Scope

当前决定：先补齐 `apps/app-api` 主责缺口；其他层面的缺口只作为
backlog / deferred follow-up 保留，不进入这一轮实现范围。

`app-api` 的未来架构职责继续固定为 shared product / control-plane
backend：

- browser surface 不直接调用 `apps/execution-gateway`
- `apps/app-api` 拥有 auth / session / principal mapping
- `apps/app-api` 拥有 surface capability policy
- `apps/app-api` 拥有 conversation、chat ingress、request lifecycle 与
  `runtime.request_execution`
- `apps/app-api` 通过 `runtime.projection_outbox` 物化 operator read model
- `apps/app-api` 拥有 request projection、request observability fact、
  quality / safety / cost / audit read surfaces
- `apps/app-api` 拥有 badcase queue、sampled grade projection 与 trace backlink
  projection
- `apps/app-api` 只消费 supervisor / agent / retrieval 返回的 typed summary，
  不反向接管 execution routing、retrieval planning 或 answer synthesis

因此，当前 app-api 总缺口收敛为以下五类。

### APP-001: QA Prerequisite Observability Audit

确认现有 app-owned projections 是否足以支撑后续 QA harness：

- `runtime.request_observability_fact`
- `operator.request_projection`
- `operator.request_audit_projection`
- `operator.quality_badcase_projection`
- `operator.quality_grade_projection`
- `operator.trace_backlink_projection`

重点不是新增第二套 truth，而是确认这些 projection 是否能承载
answer replay、badcase drill-down、sampled grading 与 eval candidate intake。

后续任务：

- `.planning/todos/pending/2026-04-24-audit-observability-qa-prereqs.md`

### APP-002: Replay-Safe Answer Trace Projection

`app-api` 需要定义并物化 operator-safe replay view，串起 request id、
trace id、surface、principal summary、requested / resolved scope、
selected target、status、reason code、evidence summary、prompt metadata、
trace / issue backlink。

边界：

- `app-api` 负责 correlation、projection、redaction 与 read model。
- supervisor / agent 负责产生 route、handoff、guardrail、retrieval 与
  finalization diagnostics。
- `app-api` 不保存 raw prompt、raw answer transcript、raw retrieved snippet 或
  raw vendor payload。

后续任务：

- `.planning/todos/pending/2026-04-24-add-campus-qa-answer-trace-replay.md`

2026-04-24 app-api execution note:

- `GET /api/operator/requests/:requestId/observability` 已补充
  operator-safe `replay` view，按 context、routing、execution、
  retrieval、answerQuality 与 prompt 分段重组现有 projection / fact，不新增第二套
  truth。
- 该 view 仍不返回 raw prompt、raw answer transcript、raw retrieval snippet、raw
  auth material 或 vendor payload。

### APP-003: Badcase / Grade / Eval Candidate Backflow

当前已有 badcase queue 与 sampled grade projection，但第一版 schema 仍偏
runtime monitor / sampled grading。后续需要 app-owned seam 支撑：

- operator 或 sampled grader 标记坏例
- badcase 带上 request / trace backlink
- badcase 能导出为 eval candidate intake
- failure class 能区分 citation、empty recall、policy、grounding、
  authz、routing-suspected 等候选归因

边界：

- `app-api` 拥有 queue、projection、ingress / export seam。
- `eval` 拥有 candidate review、golden set admission 与 release gate。

后续任务：

- `.planning/todos/pending/2026-04-24-close-product-feedback-eval-harness-loop.md`

2026-04-24 app-api execution note:

- `operator.quality_badcase_projection` 的 runtime monitor 分类已从
  `citation_missing` / `empty_recall` 扩展到 grounding、unsupported evidence、
  policy、authz 与 freshness fail-close 归因。
- `GET /api/operator/quality/eval-candidates` 已提供只读导出 seam，把 badcase、
  sampled grade 与 trace backlink 组合成 app-safe eval candidate intake。
- candidate review、golden set admission、release gate 与 fix task creation 仍属于
  eval / 后续 harness 层，不由 `app-api` 写入。

### APP-004: Memory And Restricted Authz Projection

当前 `ContextProjection` 已透传 actor / authorization / session slots，
但 `profileMemory.items` 仍为空。`app-api` 需要明确 profile memory 的
owner、来源、可见性、过期策略与 request projection summary。

边界：

- memory 可以影响 intent framing、retrieval planning preference 与 wording。
- memory 不得授予权限或扩大 retrieval ACL。
- restricted allow / deny 的最终权限语义仍依赖 canonical authorization truth
  与 retrieval pre-filter。

后续任务：

- `.planning/todos/pending/2026-04-24-productize-memory-and-restricted-authz.md`

### APP-005: Chat Request Lifecycle Capacity / Cancellation

这是 app-api 产品 runtime 缺口，但不属于 QA harness 前置条件。它涉及
request lifecycle、dedupe、timeout、cancelled / retryable / saturation
projection，以及与 execution runtime cooperative cancellation 的对齐。

当前已有独立 backlog workstream，只有在产品范围决定正式收口 public chat
容量 / 取消体验时恢复。

后续任务：

- `.planning/todos/pending/2026-04-24-restore-chat-capacity-cancellation-scope.md`

## Non-App Backlog

以下缺口不进入 app-api-first scope，保留为 backlog / deferred follow-up：

- eval governance：
  `.planning/todos/pending/2026-04-24-complete-eval-governance-prereqs.md`
- supervisor capability routing：
  `.planning/todos/pending/2026-04-24-triage-qa-capability-routing-gaps.md`
- supervisor / eval / rag-agent guardrail harness：
  `.planning/todos/pending/2026-04-24-expand-campus-qa-guardrail-harness.md`
- rag-agent internal role observability：
  `.planning/todos/pending/2026-04-24-split-rag-agent-role-observability.md`
- QA harness contract design：
  `.planning/todos/pending/2026-04-24-define-campus-qa-product-harness.md`

这些 backlog 项只有在 app-api-first 缺口收口、或对应产品范围重新
admission 后才恢复。

## QA Assistant Gaps

### QA-001: Query Surface Coverage Is Still Narrow

当前 query-enabled surface 只有：

- `regulations/student_rules`
- `curriculum/curriculum_plan`

这与目标态校园助理仍有距离。通知、服务状态、校内导航、
restricted documents、fresh news 与 live-assisted retrieval 仍处于
offline / deferred / fail-close posture。

影响：

- 真实答疑群里的高频问题会继续落入 no-answer / unsupported / fail-close。
- 用户会把“不能答”理解成系统质量问题，而不是 serving policy 结果。
- product scope 与 user expectation 容易出现偏差。

后续任务：

- `.planning/todos/pending/2026-04-24-triage-qa-capability-routing-gaps.md`

### QA-002: Capability Routing Still Has Heuristic Edges

目标态要求先判 capability family，再进入 family 内部 execution path。
当前 Go `apps/execution-gateway/internal/runtimepolicy` 与
`apps/execution-gateway/internal/structuredplanning` 已拥有 runtime policy /
structured planning；后续缺口应继续在 Go-owned admission / policy artifact /
handoff observability 上收口，而不是恢复 Python-side routing。

影响：

- 服务、通知、地点类问题可能被 generic knowledge path 吞掉。
- 已冻结但未 opening 的 structured runtime family 容易产生产品口径漂移。
- 后续新增 capability 时，路由缺陷会先表现为答案质量问题。

后续任务：

- `.planning/todos/pending/2026-04-24-triage-qa-capability-routing-gaps.md`

### QA-003: RAG Agent Internal Roles Are Still Too Coupled

目标态要求 `rag-agent` 在 capability boundary 内拆成：

- scope resolver
- retrieval planner
- answer synthesizer
- grounding validator

当前 `packages/rag-agent/src/campus_rag_agent/service.py` 的
`delegate_to_rag_agent(...)` 仍集中承载 scope、curriculum planning、
version selection、retrieval plan emission、retrieval execution、
answer synthesis、prompt synthesis failure 与 grounding downgrade。

影响：

- 单点函数承担过多 orchestration 语义，后续修改风险高。
- plan / activity / support selection 虽已存在，但角色边界仍不够清楚。
- 新增 retrieval branch 或 quality gate 时容易形成局部 patch。

后续任务：

- `.planning/todos/pending/2026-04-24-split-rag-agent-role-observability.md`

### QA-004: Memory And Authorization Productization Is Incomplete

目标态把 truth 拆成 verified identity、profile memory、session memory、
institutional knowledge 与 authorization truth。当前产品链路已经透传
actor / authorization / session slots，但 `profileMemory.items` 仍为空，
更细粒度角色差异化问答行为也仍在 out-of-scope / pending posture。

影响：

- personalization 只能做有限的 curriculum follow-up / session hint。
- 不同身份、群组、院系、年级的适用性解释仍不完整。
- restricted rollout 恢复时，deny / allow / applicability 口径需要重新压测。

后续任务：

- `.planning/todos/pending/2026-04-24-productize-memory-and-restricted-authz.md`

### QA-005: Product Feedback Is Not Yet A Closed Eval Loop

当前 release gate 与 deterministic live gate 已有较多证据，但 `eval`
workstream 仍处于 golden dataset / case governance 阶段。operator grading、
production request outcomes、badcase queue 与 future product fix task creation
尚未形成一条机器可读闭环。

影响：

- 线上失败案例不能稳定变成 eval case。
- operator observability 与 eval governance 容易各自成立但不互相驱动。
- product harness 无法稳定把产品质量回归转化为后续工程任务。

后续任务：

- `.planning/todos/pending/2026-04-24-close-product-feedback-eval-harness-loop.md`

### QA-006: Chat Capacity And Cancellation Remain Backlog

当前已有 `chat-capacity-and-cancellation-hardening` backlog workstream。
这说明 public chat 在 100 人同时提问、热点削峰、重复提交去重、
用户取消、cooperative cancellation 与多实例容量治理上仍不是完成态。

影响：

- launch 或公开试用时，体验问题可能先于答案质量问题暴露。
- request lifecycle、projection semantics 与 execution runtime cancellation
  需要统一设计，不能靠前端局部 patch。

后续任务：

- `.planning/todos/pending/2026-04-24-restore-chat-capacity-cancellation-scope.md`

## Product Harness Gaps

### HN-001: Product Harness Boundary Is Not Explicit Enough

校园问答助手需要 harness，但不应把它等同于 repo 执行器或某个 agent
framework。产品 harness 的边界应覆盖：

- request trace
- capability route / handoff trace
- guardrail verdict
- retrieval / evidence trace summary
- answer quality eval
- operator grading / badcase 回流

当前这些能力分别散在 eval、operator observability、prompt metadata、
release gate 与 request projection 中，还没有一个明确的 product harness
contract 来说明一次回答如何被复盘、评级、转成回归样例或后续任务。

影响：

- 很难稳定回答“这次回答为什么这么走、错在哪、应由谁修”。
- eval 与 observability 都存在，但不能自然合成产品质量闭环。
- 后续扩展 notice / service / navigation 时，harness 标准容易各自漂移。

后续任务：

- `.planning/todos/pending/2026-04-24-define-campus-qa-product-harness.md`

前置条件：

- 先完成 eval governance prerequisite audit。
- 先完成 observability QA prerequisite audit。
- 不在这些前置缺口未收口时提前冻结 harness contract。

### HN-002: Trace Is Not Yet A Full Answer Replay Artifact

目标态的问答 trace 不应只是日志。它应能表达 supervisor admission、
capability routing、agent handoff、retrieval plan / support selection、
guardrail verdict、finalization 与 response projection。

当前已有 request projection、prompt metadata sink、retrieval activity 与
operator observability 基础，但完整 answer replay artifact 仍不够清晰。

影响：

- 单次坏回答难以稳定复盘到 route、retrieval、prompt、evidence 或 policy。
- 多 agent / multi-surface 后，跨层 trace 断点会变成主要排障成本。
- badcase 转 eval case 时缺少结构化上下文。

后续任务：

- `.planning/todos/pending/2026-04-24-add-campus-qa-answer-trace-replay.md`

### HN-003: Guardrail Harness Is Not Yet Product-Coverage Complete

问答助手已有 scope / evidence / policy fail-close 方向，但产品 harness 还需要
系统覆盖：

- out-of-scope 与 unsupported-by-evidence
- restricted collection allow / deny / no-leak
- prompt injection / untrusted retrieved content
- capability misroute
- stale / freshness-sensitive answer
- high-risk campus policy wording

影响：

- guardrail 可能只在当前 `student_rules` / `curriculum_plan` 表现正常。
- 新 surface 打开时，安全与正确性退化可能先在线上暴露。
- “拒答正确”“澄清正确”“不能答正确”这些质量维度容易被普通 answer eval
  淹没。

后续任务：

- `.planning/todos/pending/2026-04-24-expand-campus-qa-guardrail-harness.md`

### HN-004: Handoff And Routing Eval Is Still Under-Specified

校园问答助手的长期形态是 supervisor-led multi-agent orchestration。它需要
专门评估“该交给谁”“该不该交给 RAG”“该不该 fail-close”，而不只是评估
最终答案文本。

当前 capability routing 已有方向，但 service / notice / transport /
navigation / restricted 等边界仍容易被 generic knowledge path 吞掉。

影响：

- route 错了但答案看似有内容，会掩盖真实产品缺陷。
- 新 capability family admission 时缺少统一 routing regression。
- `rag-agent` 会继续承受不该由 knowledge path 承接的问题。

后续任务：

- `.planning/todos/pending/2026-04-24-triage-qa-capability-routing-gaps.md`

### HN-005: Product Feedback Is Not Yet A Closed Harness Loop

当前 release gate 与 deterministic live gate 已有较多证据，但 operator
grading、production request outcomes、badcase queue、golden dataset 与
后续任务创建尚未形成一条闭环。

影响：

- 线上失败案例不能稳定变成 eval case。
- operator observability 与 eval governance 容易各自成立但不互相驱动。
- 产品质量改进仍依赖人工记得整理坏例。

后续任务：

- `.planning/todos/pending/2026-04-24-close-product-feedback-eval-harness-loop.md`

## Task Map

`triage-qa-capability-routing-gaps`

- Primary area: supervisor / structured runtime
- Existing route: `campus-services-notices-runtime-admission`,
  `restricted-document-rollout-verification`, navigation backlog

`split-rag-agent-role-observability`

- Primary area: `rag-agent` / retrieval
- Existing route: `bounded-agentic-retrieval-productization` reopen rule
  if role or trace contract changes

`productize-memory-and-restricted-authz`

- Primary area: identity / authz
- Existing route: `restricted-document-rollout-verification` and identity
  architecture

`close-product-feedback-eval-harness-loop`

- Primary area: product eval / operator observability / badcase intake
- Existing route: `eval`, `operator-observability-control-plane`,
  shared product surfaces hardening

`restore-chat-capacity-cancellation-scope`

- Primary area: product runtime
- Existing route: `chat-capacity-and-cancellation-hardening` backlog

`define-campus-qa-product-harness`

- Primary area: product quality harness / contracts / observability
- Existing route: `eval`, `operator-observability-control-plane`,
  prompt metadata / request projection contracts
- Prerequisite: close eval governance and observability QA prerequisite gaps

`complete-eval-governance-prereqs`

- Primary area: eval governance
- Existing route: `.planning/workstreams/eval/phases/phase-5-golden-dataset-and-case-governance`
- Purpose: close coverage matrix, denominator, qrels, workflow/status,
  deterministic answer truth and synthetic intake gaps before harness design

`audit-observability-qa-prereqs`

- Primary area: operator observability / answer replay
- Existing route: `operator-observability-control-plane` completed truth plus
  targeted follow-up audit
- Purpose: prove request trace, badcase, sampled grade and future structured
  runtime summaries are sufficient inputs for harness design

`add-campus-qa-answer-trace-replay`

- Primary area: product trace / replay / request diagnostics
- Existing route: app-api request projection, supervisor diagnostics,
  retrieval query activity, operator observability

`expand-campus-qa-guardrail-harness`

- Primary area: product safety / authz / evidence / scope regression
- Existing route: Phase 13 hallucination control, restricted rollout,
  prompt / instruction architecture

## Non-Decisions

- 本文不要求立刻打开任何 query-disabled surface。
- 本文不要求把 structured runtime capability 塞回 generic RAG。
- 本文不要求引入或冻结某个 agent framework。
- 本文不要求把产品质量 harness 等同于 repo-owned workstream harness。
- 本文不要求现在重开 completed workstreams；todo 只作为后续恢复入口。
