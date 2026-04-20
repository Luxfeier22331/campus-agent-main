---
phase: "2"
artifact: "research"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 2 Research

## Purpose

为 `Current-Truth Contract Label Migration` 建立外部依据，确认：

- raw runtime target label 是否应该与 display label / family label 分离
- contract field 是否可以安全承载多重语义
- 这条 phase 的外部最佳实践更接近 schema contract 收口，还是更接近 prompt/observability polish

## Official References Consulted

- Anthropic, `Building effective agents`
  - https://www.anthropic.com/engineering/building-effective-agents
- OpenAI docs, `Using tools`
  - https://platform.openai.com/docs/guides/tools
- OpenAI docs, `Function calling`
  - https://platform.openai.com/docs/guides/function-calling
- OpenAI docs, `Evals design guide`
  - https://platform.openai.com/docs/guides/evals-design

补充说明：

- 当前环境里，Anthropic engineering post 可以正常读取。
- OpenAI platform docs 在这个环境下不适合做长文本 autonomous fetch，但其 canonical guide URLs 已被核对为当前官方入口；以下结论只使用与 repo 场景直接相关、且不依赖长段原文复述的高层原则。

## External Conclusions

- one interface, one meaning
  - Anthropic 的文章强调 augmentations / tools 应提供 easy, well-documented interface。
  - 对我们的场景，这意味着 `selected_target` 这类 contract field 最好只承载一种稳定语义，不应同时表示 runtime dispatch target、future family label 和 operator display wording。
- routing benefits from explicit category boundaries
  - Anthropic 把 routing workflow 定义为“先分类，再交给 specialized followup task”。
  - 对我们的场景，这支持把 `SpecialistTarget` 继续视为 runtime dispatch category，而不是让它变成模糊 family taxonomy。
- explicit tools and schemas beat implicit interpretation
  - OpenAI tools / function calling 文档继续把显式 schema 和明确工具接口当作主线。
  - 这支持把 operator display label 作为显式 mapping / projection 处理，而不是靠消费方从 raw target string 推断“它大概属于哪个 family”。
- eval / observability polish is a later concern than contract semantics
  - Anthropic 与 OpenAI 的材料都把可调试、可评估放在重要位置，但前提是系统接口先清楚。
  - 对我们的场景，这说明 `Phase 2` 应优先冻结 contract semantics；trace / telemetry / eval wording 的全面收口更适合留在 `Phase 3`。

## Repo-Specific Conclusions

1. `selected_target` 应在 `Phase 2` 被明确冻结为 raw runtime target，而不是 forward family label。
2. `SpecialistTarget` 应继续只收录 current runtime targets；`rag-agent` 与 `navigation-agent` 不应在这个 phase 被塞进 shared enum。
3. panel / operator surfaces 应使用显式 display mapping，覆盖所有 current runtime targets，而不是只 special-case `rag-specialist`。
4. 如果后续确实需要 family-level grouping / reporting，应该新增一个显式命名字段或 projection。
   这是基于官方“接口语义单一、清晰”的原则做出的推断，不是官方文档的逐字要求。
5. telemetry / eval / prompt wording 的全面 convergence 继续适合放在下一 phase，避免把 schema migration 和 wording migration 混成一次高风险改动。
