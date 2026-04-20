---
phase: "5"
artifact: "research"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 5 Research

## Purpose

为 `Phase 5` 建立 opening gate 的事实基础：

- repo 当前对 operator observability / prompt runtime / execution seam 的已冻结边界
- OpenAI 当前官方文档对 tool restriction、strict structured outputs、agent specialization 与 eval-before-rollout 的主线建议

## Official References Consulted

- OpenAI docs, `Using tools`
  - https://developers.openai.com/api/docs/guides/tools
- OpenAI docs, `Function calling`
  - https://developers.openai.com/api/docs/guides/function-calling
- OpenAI docs, `Structured output`
  - https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI docs, `Agent evals`
  - https://platform.openai.com/docs/guides/agent-evals
- OpenAI docs, `Evaluation best practices`
  - https://platform.openai.com/docs/guides/evaluation-best-practices
- OpenAI, `A practical guide to building agents`
  - https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
- OpenAI Developers docs index（当前 docs IA 仍把 evaluation / agentic quality 维持为独立入口，而不是 rollout 后补充项）
  - https://developers.openai.com/

## Repo Pattern Readings

- `docs/architecture/operator-observability-architecture.md`
- `docs/architecture/prompt-and-instruction-architecture.md`
- `docs/contracts/app-api-supervisor-execution.md`
- `docs/plans/archive/completed/campus-services-notices-runtime-admission.md`
- `.planning/workstreams/campus-services-notices-runtime-admission/phases/phase-4-internal-query-service-and-supervisor-handoff-wiring/SUMMARY.md`

## Standard Stack

- eval and gate before opening
  - 官方当前文档仍把 `agent evals` / `evaluation best practices` 作为显式产品化入口，而不是 rollout 后的附属工作。
  - 这支持本 phase 先冻结 release-gate evidence，再谈 runtime opening。
- code-owned tool restriction remains required
  - tools / function calling / structured outputs 文档继续支持显式 tool subset 与 strict schema。
  - 对本 workstream 来说，这意味着 opening gate 应验证 code-owned `allowed_tools` 仍有效，而不是只验证 prompt 表现。
- specialist shape should stay narrow
  - 官方 practical guide 继续支持 manager + specialized worker / tool pattern。
  - 这支持 repo 把 service / notice lane 保持在 domain-agent + thin adapter，而不是回退成 generic RAG 或 mega-tool router。

## Architecture Patterns

- app-api remains observability read-model owner
  - repo 当前 operator observability truth 已冻结 `app-api` 是 operator-facing read-model owner。
  - 这意味着 `Phase 5` 只应冻结 execution-side typed summary seam，不应把 panel/backend query ownership 改写给 supervisor 或 specialist。
- opening must stay fail-closed
  - repo 当前 prompt/runtime truth 已把 provider refusal、schema failure、runtime unavailable 收口为 fail-close。
  - 对 service / notice runtime 来说，缺 backing query implementation、缺 evidence、缺 observability summary 时同样必须 gate closed。
- execution contract should remain stable
  - 当前 `app-api -> supervisor-api` contract 只依赖稳定的 `selected_target` / `status` / `result` / optional `observability`。
  - `Phase 5` 不应因为 opening gate 需要更多证据就扩张 browser-visible contract。

## Conclusions For Phase 5

1. `Phase 5` 应把 release gate 明确成 evidence contract，而不是“实现大致齐了就开放”。
2. opening gate 至少需要验证 fail-close、historical downgrade、stable-RAG boundary 与 minimal observability summary。
3. 如果 backing query implementation 尚未 ready，正确的 `Phase 5` truth 是 gate remains closed，而不是模糊地“部分上线”。
