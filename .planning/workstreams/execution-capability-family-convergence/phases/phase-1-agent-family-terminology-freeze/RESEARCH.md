---
phase: "1"
artifact: "research"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 1 Research

## Purpose

为 `execution-capability-family-convergence` 的首条 terminology freeze 建立外部依据，确认三件事：

- 官方 agent/tool 最佳实践是否要求固定命名后缀
- supervisor / manager 与 specialist / subagent 的职责边界应如何表达
- 对我们这个 repo 来说，`*-agent` 该被当作 repo-owned forward convention，还是被误写成“官方强制命名”

## Official References Consulted

- OpenAI, `A practical guide to building AI agents`
  - https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/
- OpenAI docs, `Using tools`
  - https://platform.openai.com/docs/guides/tools
- OpenAI docs, `Function calling`
  - https://platform.openai.com/docs/guides/function-calling
- Anthropic, `Building effective AI agents`
  - https://www.anthropic.com/engineering/building-effective-agents
- Anthropic docs, `Tool use overview`
  - https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview

## What The Official Material Supports

- stable specialized ownership matters more than a specific suffix
  - OpenAI 的 practical guide 把 manager / specialized subagents 当作一种模式，但没有规定必须用什么后缀命名。
  - Anthropic 的 effective agents guidance 也强调按清晰子任务、独立上下文和独立工具来拆分，而不是强调命名样式。
  - 对本 repo 来说，这意味着 `<domain>-agent` 可以作为前向 family convention，但不能伪装成“外部官方强制规则”。
- tools should stay explicit, bounded, and owner-attached
  - OpenAI tools / function calling 文档继续强调显式工具定义、清晰参数、可控工具集合。
  - Anthropic tool use 文档继续强调高质量工具描述和明确输入 schema。
  - 这支持我们把 family 命名冻结和 tool contract migration 分开处理：先冻结 owner family，再在后续 phase 迁移 `selected_target`、tool surface、observability label。
- orchestration role should stay distinct from specialist execution
  - OpenAI practical guide 支持 manager pattern 和 handoff / routing，而不是把所有能力压成单一 mega-agent。
  - Anthropic effective agents 也把 orchestrator + specialized worker 视为复杂任务下的合理模式。
  - 这支持我们继续保持 `supervisor` 为 invariant top-level role，不引入 `supervisor-agent`。
- start with a simple naming rule once boundaries are stable
  - 官方材料没有给出 repo naming template，但都默认 specialized owner 和 handoff relation 必须稳定、少歧义。
  - 这支持我们在 repo 内冻结一个简单规则：
    - current-truth runtime / package / contract label 可以保留 legacy `*-specialist`
    - forward family label 统一采用 `<domain>-agent`
    - `availability-specialist` 在明确决策前不提前发明新 alias

## Repo-Specific Conclusions

1. `supervisor` 应保持 invariant top-level role name；这符合 orchestration role 与 specialist execution 分层的外部最佳实践。
2. `rag-specialist -> rag-agent` 应被明确写成 repo-owned convergence pair，而不是继续在不同文档里混用又不说明。
3. `navigation-specialist -> navigation-agent` 也应以同样方式表达：current truth 与 forward truth 并存，但不冒充已迁移完成。
4. `campus-services-agent` 与 `notice-agent` 已经是清晰的 forward family labels，适合继续保留。
5. `availability-specialist` 当前缺少同等明确的 forward decision，所以 Phase 1 应显式写成 deferred posture，而不是提前造出 `availability-agent`。
