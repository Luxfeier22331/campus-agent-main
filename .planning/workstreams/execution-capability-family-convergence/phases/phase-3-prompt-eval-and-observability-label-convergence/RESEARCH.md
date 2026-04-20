---
phase: "3"
artifact: "research"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 3 Research

## Purpose

为 `Prompt Eval And Observability Label Convergence` 提供外部依据，确认：

- prompt wording、eval labels、observability labels 是否应共用一套显式 vocabulary
- 哪些 surface 适合继续保留 raw runtime target，哪些 surface 应走 derived display/family label
- prompt change 与 eval / monitoring 之间的联动在官方最佳实践下应该怎样收口

## Official References Consulted

- Anthropic, `Building effective agents`
  - https://www.anthropic.com/engineering/building-effective-agents
- OpenAI Cookbook, `Building resilient prompts using an evaluation flywheel`
  - https://developers.openai.com/cookbook/examples/evaluation/building_resilient_prompts_using_an_evaluation_flywheel
- OpenAI Developers docs navigation
  - https://developers.openai.com/docs/guides/prompting
  - https://developers.openai.com/docs/agents
- OpenTelemetry, `Semantic conventions`
  - https://opentelemetry.io/docs/concepts/semantic-conventions/
- OpenTelemetry, `General trace semantic conventions`
  - https://opentelemetry.io/docs/specs/semconv/general/trace/

## External Findings

### 1. Clear surfaces should keep one primary meaning

- Anthropic 强调最有效的 agent systems 倾向于 simple, composable patterns，而 augmented capabilities 应提供 easy, well-documented interface。
- 对我们的场景，这支持把 raw runtime target、operator display label、forward family label 分开治理，而不是继续靠单个字符串跨 surface 共用。

### 2. Routing categories and specialized follow-up tasks should stay explicit

- Anthropic 将 routing 描述为“先分类，再交给 specialized followup task”。
- 这说明 runtime dispatch category 本身应保持稳定、明确，不适合在 prompt/eval/observability 收口时被静默改造成另一层 taxonomy。
- 对 repo 而言，这进一步支持：
  - current runtime target 继续留在 `selected_target`
  - family / display label 通过显式 mapping 或 projection 派生

### 3. Prompt changes should be tied to eval loops, not isolated wording edits

- OpenAI Cookbook 的 evaluation flywheel 明确把 prompt resilience 建模为 Analyze -> Measure -> Improve 的持续循环。
- 同一文档进一步建议把 graders 集成到 CI/CD，并监控生产数据以发现新的 failure modes。
- 对我们的场景，这意味着 prompt wording convergence 不能只改 prompt markdown；必须与 eval label/reporting surface 一起收口，否则 Phase 3 结束后仍无法稳定比较 prompt 版本影响。

### 4. Observability naming should use a common scheme across codebase and platforms

- OpenTelemetry semantic conventions 的核心价值是提供 common naming scheme，并在 codebase、libraries、platforms 间标准化。
- General trace conventions 进一步强调统一 attribution，这样 operator 不需要学习语言/实现特定的差异。
- 对我们的场景，这支持：
  - raw telemetry/storage fields 继续保留少量、稳定、统一的 canonical names
  - operator/report wording 不应直接复制底层 raw field value，而应通过统一 mapping/projection 输出

### 5. OpenAI 官方文档已经把 prompting、observability、agent workflow evaluation 拆成独立文档面

- 当前 OpenAI Developers 文档导航把 `Prompt guidance`、`Integrations and observability`、`Evaluate agent workflows` 分成独立轨道。
- 这不是直接的实现规范，但它支持我们把 `Phase 3` 明确建模成：
  - prompt family wording
  - eval/report vocabulary
  - observability/operator wording
  三个并列面，而不是继续混成单一“改名任务”。

## Repo-Specific Conclusions

1. `Phase 3` 不应再碰 `selected_target` / `selectedTarget` 的 contract enum；这在 `Phase 2` 已冻结。
2. prompt-facing wording 应从 raw runtime target label 中解耦，否则 package-owned prompt family 会继续把 legacy runtime label 暴露成 model-facing persona truth。
3. eval 需要区分：
   - runtime assertion truth
   - report/display/family truth
   这是基于官方 eval flywheel 与 Anthropic explicit-routing 原则做出的 repo-specific 推断。
4. observability / operator read model 继续允许以 `selected_target` 作为 raw dimension，但用户/operator-facing文本、分组、汇总应通过显式 mapping/projection 输出，而不是直接暴露 raw string。
5. `Phase 3` 的正确落点是 wording / reporting / projection rule convergence，而不是 schema rename；schema/package/runtime rename 继续放在 `Phase 4`。
