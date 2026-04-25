---
doc_type: architecture
status: active
created: 2026-04-23
updated: 2026-04-23
---
# Capability Routing And Admission Architecture

## 文档边界

本文冻结 `campus-agent` 在长期产品路径上的 `admission + capability routing` supporting
architecture。

它回答的是：

- 顶层产品入口应先做什么判断、后做什么判断
- `admission` 与 `routing` 应怎样分层
- `requested_scope`、`capability family`、clarification 分别属于哪一层
- `apps/app-api`、`apps/supervisor-api`、`apps/supervisor-agent-worker` 与 agent
  各自负责什么

它不负责：

- 当前 merged truth 是否已经完成 capability-neutral routing
- 某一轮代码实施顺序
- 某个具体 capability family 的内部 planner / retrieval 细节

当前 merged truth 仍以 `docs/architecture/current-architecture.md` 为准。本文描述的是长期
supporting architecture，不得把它误读成“public chat 当前已经不是 knowledge-only”。

## Core Conclusion

`campus-agent` 的长期入口模型不是：

- 先把所有请求当成 generic knowledge/RAG 问题
- 再在知识路径里临时分叉出 notice、service、navigation

而是：

`surface intake -> admission / guardrails -> capability routing ->
agent-owned execution -> supervisor finalization`

其中固定规则如下：

- 顶层默认先判定 `capability family`，而不是先判定 retrieval `scope`
- `requested_scope` 只属于 knowledge-family path，不是所有请求共享的顶层默认字段
- `admission` 与 `routing` 必须分层，避免把 authz、surface policy、approval-required 与
  domain reasoning 混在一起
- `rag-agent` 仍是核心 capability family，但不再被默认等同于整个产品入口语义

## Current Truth Vs Forward Truth

当前 repo 仍保持以下 merged truth：

- `public-chat-web -> app-api` 的公开 chat 请求当前只开放 `knowledge`
- `place_lookup` 在 execution contract 中仍存在，但当前产品路径继续 fail-close；
  地图 UI、route planning 与 `place_card` product consumption 等 navigation 能力等地图产品上线后再开放
- `notice-agent`、`campus-services-agent` 是已冻结的前向 capability family；internal
  execution wire 已接受显式 `notice` / `campus_services` capability label 并映射到对应
  lane，但它们还不是当前默认公开主路径

这些都属于当前 surface posture，而不是长期 routing architecture 的原则。

本文冻结的 forward truth 只有两条：

- 顶层 supervisor 必须是 neutral capability router
- 不允许把 “当前公开主路径最成熟的是 knowledge QA” 反写成长期入口必须 `RAG-first`

## Layered Execution Shape

长期产品执行路径固定拆成五层：

1. `surface intake`
1. `admission / guardrails`
1. `capability routing`
1. `agent-owned execution`
1. `supervisor finalization`

### 1. Surface Intake

surface intake 由 browser surface 与 shared `apps/app-api` 一起承担。

它长期负责：

- session / principal / operator context 解析
- surface-level request normalization
- surface capability allowlist 检查
- 最小 typed context projection

它长期不负责：

- domain reasoning
- retrieval planning
- 在多个 capability family 之间做最终 handoff

补充约束：

- `public-docs` 是 docs-first browser surface，不自动进入这条 execution routing path
- `public-chat-web`、future `服务状态`、future `校园地图` 可以拥有不同 capability set
- 单个 surface 的内部 IA 不自动升级成产品级 routing 原则

### 2. Admission / Guardrails

`admission` 是顶层 deterministic gate。

它长期负责：

- surface 是否允许该 capability
- authz / visibility / restricted posture
- approval-required
- hard reject
- 明显 `out_of_scope`

固定规则：

- `admission` 先于 `routing`
- prompt 不得覆盖 deterministic gate
- agent 不得反向放开上游已关闭的 capability 或 surface policy

### 3. Capability Routing

`routing` 是 supervisor-owned 的中立 capability 决策层。

它长期只负责回答：

- 这次请求应该进入哪个 admitted capability family
- 当前是否需要 `routing clarification`
- 当前是否应直接 `delegate`、`approval_required`、`rejected` 或 `out_of_scope`

它长期不负责：

- knowledge-family 内部的 query rewrite
- retrieval `scope` 的细粒度解析
- notice/service/navigation 域内的最终业务解释

长期默认只路由到 repo admitted capability family，例如：

- `rag-agent`
- `notice-agent`
- `campus-services-agent`
- `navigation-agent`

如果未来明确接受新的 capability，它必须先以 repo-owned family label 入场，而不是作为 hidden fallback。

### 4. Agent-Owned Execution

一旦 capability family 已确定，后续执行 truth 归对应 agent 拥有。

固定分工：

- `rag-agent`
  - knowledge-family 内部 intent / ambiguity / clarification / retrieval planning
    / answer synthesis
- `notice-agent`
  - notice discovery / canonical notice reading / historical downgrade
- `campus-services-agent`
  - structured current-state / process / directory / schedule lookup
- `navigation-agent`
  - place lookup，与 future route/wayfinding expansion 保持同一 family

### 5. Supervisor Finalization

supervisor 长期继续统一负责：

- response finalization
- fail-close terminal semantics
- selected target / status / observability summary
- audit / operator projection 所需的 typed execution outcome

## Surface Capability Policy

`surface capability policy` 的长期 owner 固定为 `apps/app-api`。

直接含义：

- `public-chat-web` 当前 knowledge-only 是 surface posture
- `public-docs` 不消费 execution routing，不因此拥有 `knowledge` capability
- future `服务状态`、`校园地图` 等 surface 可以开放不同 capability set
- `apps/supervisor-api` 不拥有 product-layer surface allowlist truth

禁止做法：

- 把某个 surface 当前开放的 capability 直接写死成整个 repo 的长期入口原则
- 让 `apps/supervisor-api` 或 agent 反向拥有 browser-facing capability policy

## Capability Family First, Scope Second

长期规则固定为：

- 顶层先解析 capability family
- 只有进入 knowledge-family path 后，才进一步解析 retrieval `scope`

因此：

- `requested_scope` 不是顶层普适入口字段
- `requested_scope` 不应用来替代 capability routing
- retrieval / serving supporting architecture 只在 capability 已进入 knowledge-family
  path 后生效

在当前 repo 里，这意味着：

- `docs/architecture/system/retrieval-serving-architecture.md`
  只描述 knowledge-family 内部 retrieval truth
- `docs/architecture/system/agentic-retrieval-architecture.md`
  只描述 knowledge-family 的 target-state planner/executor shape

## Clarification Split

长期固定区分两类 clarification：

- `routing clarification`
  - 顶层尚不能稳定判定 capability family 或缺少进入某个 family 的关键路由槽位
- `agent clarification`
  - 已经选定 capability family，但该 family 内部仍需要 disambiguation / slot completion

固定规则：

- `routing clarification` 由 supervisor 触发
- `agent clarification` 由对应 agent 触发
- 两者不得在 observability、eval truth 或 contract 语义上混成一个模糊的 clarification 桶

## Routing Intent

长期上，supervisor 的顶层 routing 输出必须是 typed routing intent，而不是 prompt 内部隐式决策。

它至少应显式表达：

- admitted capability family
- task kind
- next action
- risk level
- missing slots
- policy reason
- optional knowledge-family-specific `requested_scope`
- optional routing confidence / routing summary

补充约束：

- 本文冻结的是概念 contract，而不是当前 wire shape
- 当前 internal execution contract 仍以 `requested_capability + optional
  requested_scope` 为 current truth
- forward wire shape 的演进由 `docs/contracts/app-api-supervisor-execution.md` 补充说明

## Observability And Evaluation

capability routing 不是纯 prompt 细节，必须进入长期 observability / eval truth。

至少需要可追踪：

- requested capability hint
- finalized selected target
- routing / agent clarification 区分
- policy / scope / approval 分支
- requested scope 与 resolved scope 的分层

固定规则：

- routing changes 进入 release path 前必须有独立 eval
- 不能只用最终 answer quality 掩盖顶层路由错误
- operator-facing summary 必须能区分“路由错了”和“进入正确 agent 但证据不足”

## Forbidden Shapes

- 不把所有请求默认压成 `rag-agent`，再在 knowledge path 内临时 patch 其他能力
- 不用 `requested_scope` 充当 capability family 的代理字段
- 不让 agent 反向改写 surface capability policy
- 不把 structured runtime capability 伪装成 generic retrieval fallback
- 不让 browser surface 绕开 `app-api` 直接推理最终 capability routing
- 不把 `routing clarification` 与 `agent clarification` 混成一个模糊状态

## 相关稳定文档

- `docs/architecture/product-positioning.md`
- `docs/architecture/system/product-runtime-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/system/agentic-retrieval-architecture.md`
- `docs/contracts/app-api-supervisor-execution.md`
- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
