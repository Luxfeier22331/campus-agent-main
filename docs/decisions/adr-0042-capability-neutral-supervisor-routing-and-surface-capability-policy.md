---
doc_type: decision
decision_id: ADR-0042
status: accepted
created: 2026-04-23
updated: 2026-04-23
---
# ADR-0042 Capability-Neutral Supervisor Routing And Surface Capability Policy

## 状态

Accepted on 2026-04-23.

## 背景

`campus-agent` 当前已经冻结了以下方向：

- `campus-agent` 是 institution-scoped campus assistant，而不是开放域 generalist
- `apps/app-api -> apps/supervisor-api -> packages/supervisor-core -> agent`
  是长期执行主链
- `rag-agent`、`navigation-agent`、`campus-services-agent`、`notice-agent` 已作为当前或前向
  capability family 落盘
- 当前公开产品能力最成熟的主路径仍是 knowledge question answering

但 repo 仍缺一条更高层的正式决策：

- 顶层 supervisor 是否继续默认把产品入口理解成 `knowledge/RAG` 路由器
- `requested_scope` 是否仍应被默认理解成所有请求共享的顶层入口字段
- `public chat` 当前 knowledge-only posture 是否会被误读成长期产品架构原则
- clarification、approval、out-of-scope 与 capability routing 之间应如何分层

如果这条边界不冻结，后续实现很容易继续退化为：

- 所有请求先进入 `rag-agent`，再在 knowledge path 内临时补 notice/service/navigation 分叉
- 用 `requested_scope` 代替 capability routing
- 把 `public chat` 当前 knowledge-only 姿态写成整个 repo 的长期入口真相
- 把 routing clarification 与 agent clarification 混成一个模糊 clarification 桶

## 决策

### 决策 1：supervisor 长期是 neutral capability router，而不是 knowledge-default router

长期上，top-level supervisor 必须先回答“这是什么 capability family 的请求”，而不是默认先把请求当成 generic
knowledge/RAG 问题。

直接含义：

- `rag-agent` 仍是核心 capability family，但不再等于整个产品入口语义
- notice、service、navigation 与 future admitted capability 必须作为并列 family 被治理
- capability routing 是 repo-owned architecture truth，不是 prompt 内部的临时推理副作用

### 决策 2：`admission` 与 `routing` 必须显式分层

长期固定拆成两层：

- `admission / guardrails`
  - authz、surface allowlist、approval-required、hard reject、显式 out-of-scope
- `capability routing`
  - capability family 选择、routing clarification、handoff shaping

直接含义：

- approval、reject、out-of-scope 不应被 agent 自由覆盖
- routing 不应反向拥有 authz / surface policy
- “先过 deterministic gate，再做 capability routing” 是长期不退回的结构

### 决策 3：surface capability policy 的 owner 固定为 `apps/app-api`

长期上，哪个 browser surface 当前允许哪些 capability，由 `apps/app-api` 拥有。

直接含义：

- `public-chat-web` 当前 knowledge-only 只是 current surface posture
- `public-docs` 不自动进入 execution capability routing
- future `服务状态`、`校园地图` 等 surface 可以拥有不同 capability set
- `apps/supervisor-api` 与 agent 都不拥有 browser-facing capability allowlist
  truth

### 决策 4：`requested_scope` 只属于 knowledge-family path

长期上，`requested_scope` 不再被视为所有请求共享的顶层默认入口字段。

固定规则：

- 顶层先判 capability family
- 只有进入 knowledge-family path 后，才解析 retrieval `scope`
- `requested_scope` 不能代替 capability family 判断

直接含义：

- retrieval / serving 文档只负责 knowledge-family 内部 truth
- structured runtime capability 不再被描述成 retrieval scope 的特殊分支

### 决策 5：clarification 固定拆成 routing clarification 与 agent clarification

长期固定区分：

- `routing clarification`
  - supervisor 无法稳定确定 capability family，或缺少顶层路由所需关键信息
- `agent clarification`
  - capability family 已确定，但 family 内部仍存在业务歧义或槽位缺失

直接含义：

- 两者在 contract、observability、eval 里不得再混成同一类 clarification
- supervisor 拥有前者，agent 拥有后者

### 决策 6：capability routing 变更必须进入独立 eval 与 observability

长期上，routing truth 不能只靠最终 answer quality 间接验证。

至少需要：

- capability routing accuracy
- routing clarification precision
- false handoff / false accept / false reject
- approval-required recall
- selected target / resolved scope / refusal class 的分层 observability

缺少这些证据时，不允许把新的 routing 变化视为稳定架构的一部分。

### 决策 7：当前 public chat knowledge-only posture 不是长期架构原则

当前 merged truth 继续允许：

- public chat 只开放 `knowledge`
- `place_lookup` 在产品路径上继续 fail-close；地点查询、route planning、地图 UI 与
  `place_card` product consumption 等地图产品上线后再独立 admission

但这只表示 current rollout posture，不表示：

- 长期 supervisor 仍是 knowledge-default router
- 未来所有 surface 都必须先走 knowledge path

## 结果

直接结果如下：

- 后续 architecture 文档必须把 capability-neutral routing 与 knowledge-family retrieval
  分开书写
- `requested_scope` 的长期语义必须收窄为 knowledge-family-specific field
- `apps/app-api`、`apps/supervisor-api`、`packages/supervisor-core` 与 agent
  的边界说明必须围绕 `surface policy -> admission -> routing -> agent` 收口
- 当前 browser-facing / internal execution contract 若还保留 `requested_capability +
  requested_scope`，必须显式区分 current truth 与 forward evolution

## Complementary Decisions

本 ADR complements：

- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.m
  d`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
- `docs/decisions/adr-0030-institution-scoped-product-path-and-explicit-open-dom
  ain-admission.md`

本 ADR 不 supersede 上述 ADR；它只补充“capability-neutral routing 与 surface capability
policy”的长期边界。
