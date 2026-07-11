---
doc_type: decision
truth_scope: repository
owner_boundary: docs/decisions
decision_id: ADR-0042
status: superseded
created: 2026-04-23
updated: 2026-07-10
superseded_by: ADR-0071
---
# ADR-0042 Tool-Routed Execution And Surface Tool Policy

## 状态

Accepted on 2026-04-23. Superseded by ADR-0071 on 2026-07-10.

ADR-0071 retains the primary-agent-first and tool-first/scope-second direction,
but replaces this ADR's app-api-owned surface tool policy and custom routing
intent governance with execution-control-owned runtime admission and standard
tool trajectory evidence.

## 背景

`campus-agent` 当前已经冻结了以下方向：

- `campus-agent` 是 institution-scoped campus assistant，而不是开放域 generalist
- `apps/app-api -> apps/execution-control -> Temporal -> activity workers ->
  apps/agent-runtime primary agent loop / Go RAG graph / typed tools` 是当前
  执行主链
- `knowledge_query`、`place_lookup`、`public_web_search` 与
  `transport_schedule_lookup` 等具体 tool id 已作为当前 contract/runtime
  labels 落盘；退役 tool id 不再作为前向 tool domain
- 当前公开产品能力最成熟的主路径仍是 knowledge question answering

但 repo 仍缺一条更高层的正式决策：

- 顶层执行路径是否继续默认把产品入口理解成 `knowledge/RAG` 路由器
- `knowledge_query.scope` 是否应被默认理解成所有请求共享的顶层入口字段
- `online answer` 当前 knowledge-only posture 是否会被误读成长期产品架构原则
- clarification、approval、out-of-scope 与 tool routing 之间应如何分层

如果这条边界不冻结，后续实现很容易继续退化为：

- 所有请求先进入 `knowledge`，再在 knowledge path 内临时补 notice/service/navigation 分叉
- 用 `scope` 代替 tool routing
- 把 `online answer` 当前 knowledge-only 姿态写成整个 repo 的长期入口真相
- 把 routing clarification 与 agent clarification 混成一个模糊 clarification 桶

## 决策

### 决策 1：Primary Agent 是普通 chat 的第一语义决策入口

长期上，普通 chat 先进入 product-level primary agent decision。模型在
`execution-control` / workflow 裁剪后的 admitted tool set 内判断 direct
no-tool、notice、campus_services、navigation 或 `knowledge_query`，而不是由
入口默认先把请求当成 generic knowledge/RAG 问题。

直接含义：

- `knowledge` 仍是核心 tool domain，但不再等于整个产品入口语义
- notice、service、navigation 与 future admitted tools 必须作为并列 tool domain 被治理
- selected tool / internal route 必须进入 repo-owned sanitized projection，
  不能只作为 prompt 内部临时推理副作用

### 决策 2：`admission` 与 `routing` 必须显式分层

长期固定拆成两层：

- `admission / guardrails`
  - authz、surface allowlist、approval-required、hard reject、显式 out-of-scope
- `tool routing`
  - tool domain 选择、routing clarification、handoff shaping

直接含义：

- approval、reject、out-of-scope 不应被 agent 自由覆盖
- routing 不应反向拥有 authz / surface policy
- “先过 deterministic gate，再做 tool routing” 是长期不退回的结构

### 决策 3：surface tool policy 的 owner 固定为 `apps/app-api`

长期上，哪个 browser surface 当前允许哪些 tool，由 `apps/app-api` 拥有。

直接含义：

- `campus-web` 当前 knowledge-only 只是 current surface posture
- `public-docs` 不自动进入 execution tool routing
- future `服务状态`、`校园地图` 等 surface 可以拥有不同 tool set
- `apps/execution-control` 与 agent 都不拥有 browser-facing tool allowlist
  truth

### 决策 4：`knowledge_query.scope` 只属于 knowledge tool path

长期上，`scope` 不被视为所有请求共享的顶层默认入口字段。

固定规则：

- 顶层先判 tool domain
- 只有进入 knowledge tool path 后，才解析 retrieval `scope`
- `scope` 不能代替 tool domain 判断

直接含义：

- retrieval / serving 文档只负责 knowledge tool 内部 truth
- tool read model tool 不再被描述成 retrieval scope 的特殊分支

### 决策 5：clarification 固定拆成 routing clarification 与 agent clarification

长期固定区分：

- `routing clarification`
  - primary agent / Execution Agent Layer 无法稳定确定需要哪个 admitted
    tool domain，或缺少顶层工具选择所需关键信息
- `agent clarification`
  - tool target 已确定，但具体参数仍存在业务歧义或槽位缺失

直接含义：

- 两者在 contract、observability、eval 里不得再混成同一类 clarification
- Execution Agent Layer 拥有前者的 durable terminal / projection 语义，具体
  问句生成可由 primary agent runtime 完成；tool-domain owner 拥有后者

### 决策 6：tool routing 变更必须进入独立 eval 与 observability

长期上，routing truth 不能只靠最终 answer quality 间接验证。

至少需要：

- tool routing accuracy
- routing clarification precision
- false handoff / false accept / false reject
- approval-required recall
- selected tool / resolved scope / refusal class 的分层 observability

缺少这些证据时，不允许把新的 routing 变化视为稳定架构的一部分。

### 决策 7：当前 online answer knowledge-only posture 不是长期架构原则

当前 merged truth 继续允许：

- online answer 仍可按 rollout posture 只开放成熟 tool 子集
- `place_lookup` 在产品路径上继续 fail-close；地点查询、route planning、地图 UI 与
  `place_card` product consumption 等地图产品上线后再独立 admission

但这只表示 current rollout posture，不表示：

- 长期 Execution Agent Layer 仍是 knowledge-default router
- 未来所有 surface 都必须先走 knowledge path
- ordinary chat 缺失 `requested_tool` 时可以被 app-api 或
  execution-control 默认伪造成 `knowledge_query`

## 结果

直接结果如下：

- 后续 architecture 文档必须把 tool-routed execution 与 knowledge tool retrieval
  分开书写
- `scope` 的长期语义必须收窄为 knowledge-tool-specific field
- `apps/app-api`、`apps/execution-control`、`apps/agent-runtime` 与 tool
  workers 的边界说明必须围绕 `surface policy -> durable admission ->
  primary agent decision -> admitted tool / RAG graph -> finalization` 收口
- browser-facing / internal execution contract 使用 `requested_tool + optional scope`
  时，必须显式区分 caller hint、model-facing knowledge scope 与最终 selected tool

## Complementary Decisions

本 ADR complements：

- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- `docs/decisions/adr-0015-user-identity-memory-and-personalization-boundaries.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
- `docs/decisions/adr-0030-institution-scoped-product-path-and-explicit-open-dom
  ain-admission.md`

本 ADR 不 supersede 上述 ADR；它只补充“primary-agent-first tool routing 与 surface
tool policy”的长期边界。
