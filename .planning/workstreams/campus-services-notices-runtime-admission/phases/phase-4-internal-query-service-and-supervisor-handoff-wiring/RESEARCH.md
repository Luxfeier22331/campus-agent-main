---
phase: "4"
artifact: "research"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 4 Research

## Purpose

把 `Phase 4` 的 wiring freeze 建立在两类事实之上：

- repo 当前 `app-api -> supervisor-api -> supervisor-core -> specialist` execution seam
- 最新官方 agent/tool guidance 对 manager + specialized agent + code-owned tool subset 的支持

## Official References Consulted

- OpenAI, `A practical guide to building agents`
  - https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
- OpenAI docs, `Function calling`
  - https://platform.openai.com/docs/guides/function-calling
- OpenAI docs, `Tools`
  - https://platform.openai.com/docs/guides/tools

## Repo Pattern Readings

- `docs/contracts/app-api-supervisor-execution.md`
- `docs/architecture/execution-and-specialists-architecture.md`
- `packages/contracts/src/campus_contracts/models.py`
- `packages/supervisor-core/src/campus_supervisor_core/context.py`
- `packages/supervisor-core/src/campus_supervisor_core/routing.py`
- `packages/supervisor-core/src/campus_supervisor_core/framing.py`
- `packages/supervisor-core/src/campus_supervisor_core/agent.py`
- `packages/supervisor-core/src/campus_supervisor_core/policy.py`
- `tests/supervisor/test_supervisor_core.py`

## Standard Stack

- manager-led routing stays stable
  - 官方 agent guidance 继续支持一个 manager/supervisor 做 routing 和 terminal semantics，再把能力内执行交给更窄的 agent/tool。
  - 这与 repo 当前 `supervisor` 的 owner 边界一致。
- tool subset must be code-owned
  - 官方 tools guidance 继续支持显式限制可用工具集合。
  - 对本 phase 来说，这意味着 `allowed_tools` 必须进代码和 handoff truth，不能停留在 prompt 约定。
- thin adapter over stable schema
  - function calling / strict schema guidance 继续支持“adapter 只负责参数映射与结果回填”。
  - 这支持 repo 继续把 internal query service 与 tool adapter 分层，而不是把查询逻辑写进 prompt 或 supervisor。

## Architecture Patterns

- app-api is not query owner
  - 当前 contract 已经冻结 `app-api` 只负责产品层 auth/session/request projection。
  - 让 `app-api` 直接拥有 internal query service 会破坏 product/runtime 与 execution engine 分层。
- supervisor is not truth owner
  - `supervisor-core` 应继续负责 routing / handoff / finalization。
  - 真正的 query truth owner 必须在 internal query service / tool adapter 之后，而不是塞回 `supervisor-core`。
- label coexistence should not block wiring
  - 当前 `SpecialistTarget` 仍是 `rag-specialist` / `availability-specialist` / `navigation-specialist`。
  - wiring freeze 应优先把 handoff/adapter 方向写清，而不是等 repo-wide rename 完成后才动。

## Don't Hand-Roll

- 不要让 `app-api` 直接调用 source/projection query truth。
- 不要让 `supervisor-core` 直接实现 service/notice projection query。
- 不要把 `allowed_tools` 只写成 prompt 约定。
- 不要因为 current-truth label 还没迁移，就把新 capability 再塞回旧 `availability-specialist` / `rag-specialist` 里糊过去。

## Conclusions For Phase 4

1. `Phase 4` 应先冻结 handoff / adapter / internal query service 的 implementation direction。
2. `app-api` 与 `supervisor-core` 的 owner boundary 不应被新 tool 破坏。
3. per-agent `allowed_tools` 必须成为 code-owned enforcement truth。
