---
doc_type: architecture
status: active
created: 2026-04-02
updated: 2026-04-11
---

# Execution And Specialists Architecture

## 文档边界

本文冻结 execution engine、supervisor 与 specialist supporting architecture。

它回答的是：

- `apps/supervisor-api` 与 `packages/supervisor-core` 分别负责什么
- supervisor 如何与 specialist 交互
- RAG specialist 与其他 specialist 的长期角色是什么

## Execution Chain

当前与长期都遵循：

`app-api -> supervisor-api -> supervisor-core -> specialist -> retrieval-core -> evidence -> supervisor response`

边界固定如下：

- `apps/supervisor-api` 负责 internal execution admission 与 transport
- `packages/supervisor-core` 负责 policy-driven orchestration
- specialist 负责能力边界内的 planning / evidence consumption / answer shaping
- `packages/retrieval-core` 负责 evidence retrieval kernel，而不是顶层编排

## Supervisor Responsibilities

supervisor 长期负责：

- intent framing
- risk / safety gate
- specialist routing
- handoff shaping
- response finalization
- fail-close terminal semantics

supervisor 不负责：

- retrieval backend 细节
- collection-specific ingestion logic
- product-layer auth/session ownership
- 将 specialist 降级成扁平 tool bundle

## Specialist Model

specialist 是稳定能力边界，不等于某个底层框架对象。

当前已接受的 specialist family：

- `rag-specialist`
- `availability-specialist`

后续如引入新 specialist，必须满足：

- 能力边界长期稳定
- handoff contract 可显式化
- workflow / safety / eval 可重复验证

## RAG Specialist Responsibilities

`packages/rag-specialist` 当前与长期负责：

- retrieval-oriented request framing
- ambiguity handling
- clarification / no-answer / completed policy
- grounded answer synthesis
- personalization inputs within authz boundary

它不负责：

- canonical authz truth
- product-layer identity / session / memory ownership
- retrieval vendor/runtime freeze

## Retrieval And Execution Contract

- specialist 与 supervisor 通过 `packages/contracts` 交互
- retrieval / infra types 不进入 shared contract
- `ContextProjection` / `SupervisorResponse` 是当前 merged truth 的 shared seam
- future specialist growth 只能在这个 seam 之后扩张

## Runtime Posture

`apps/supervisor-api` 表示 execution engine boundary，不代表 repo-wide HTTP/runtime freeze。

当前重要的是：

- transport 留在 `apps/*`
- orchestration 留在 `packages/supervisor-core`
- specialist behavior 留在 specialist package

## Prompt And Instruction Ownership

execution path 的 prompt / instruction 继续遵循 package-owned ownership：

- `packages/supervisor-core`
  owns supervisor role instructions、clarification / reject / approval / out-of-scope wording prompt families
- `packages/rag-specialist`
  owns answer / clarify / no-answer / unsupported prompt families
- `packages/retrieval-core`
  不拥有 top-level task prompt；只拥有 evidence retrieval 与 serialization helper
- `apps/supervisor-api`
  不拥有长期 prompt truth；只负责 request packaging 与 execution admission

prompt 不能替代 code-owned routing、authz、serving filter 或 fail-close terminal semantics。

execution path 的最终 prompt stack 也固定为：

`repo-global developer invariants -> package-owned role prompt -> typed task/evidence packet -> code-side finalization`

补充约束：

- `apps/supervisor-api` 与后续 product runtime 只负责装配与执行，不拥有新的 monolithic mega system prompt
- `packages/retrieval-core` 继续只提供 evidence serialization helper，不拥有 top-level prompt truth
- `system prompt` 这个词在 repo 里只保留为沟通简称；真正运行时应以 developer prompt + typed packets 表达

## Forbidden Shapes

- 不把 supervisor 重新写成被动转发层
- 不把 specialist 重新降级成 `campusRAG` 式扁平 tool
- 不把 retrieval implementation 细节塞回 `packages/supervisor-core`
- 不让 `apps/supervisor-api` 恢复 product backend、operator query 或 browser API 责任

## 相关稳定文档

- `docs/decisions/adr-0006-agent-orchestration-and-safety.md`
- `docs/decisions/adr-0017-supervisor-internal-execution-admission.md`
- `docs/architecture/prompt-and-instruction-architecture.md`
- `docs/reference/runtime-serving-and-index-terms.md`
