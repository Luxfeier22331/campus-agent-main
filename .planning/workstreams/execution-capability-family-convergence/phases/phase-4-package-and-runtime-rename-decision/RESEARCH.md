---
phase: "4"
name: "Package And Runtime Rename Decision"
created: 2026-04-21
updated: 2026-04-21
status: planned
---

# Phase 4 Research

## Question

在 `Phase 1-3` 已经完成 family vocabulary、contract semantics、prompt/eval/observability label split 之后，既然已明确选择 one-shot full rename，repo 应如何执行这次 full rename，才能避免半迁移和长期 compatibility debt？

## External References

### Anthropic: Building effective agents

Link:
- <https://www.anthropic.com/engineering/building-effective-agents>

Relevant guidance:
- 推荐先用简单、可组合的模式，而不是无必要增加复杂度。
- routing 应把输入导向 specialized follow-up task，并保持清晰分工。

Implication for this repo:
- `Phase 1-3` 已经把 family label、routing truth、prompt/eval/observability wording 分层完成。
- 对于 `Phase 4`，真正的问题不再是“是否需要更清晰的 agent family vocabulary”，而是“是否值得再额外付出一次结构性 rename 成本”。
- 如果 rename 不能显著提升 capability boundary clarity，而只是为了表面一致性，就不符合“先保持简单、只在必要时增加复杂度”的建议。

### OpenAI: A practical guide to building agents

Link:
- <https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf>

Relevant guidance:
- 应先尽量发挥单个 agent 的能力，再增加额外复杂度。
- 清晰 instructions 和明确动作能减少歧义。

Implication for this repo:
- repo 当前已经通过 `Phase 1-3` 把对外 family vocabulary 和内部 runtime identity 拆开。
- 现阶段 package/import rename 不会提升 agent capability 本身，只会引入额外变更面。
- 因此 rename 只有在“显著降低 repo-level ambiguity 或维护成本”时才成立，而不能只是为了让名称更整齐。

### OpenTelemetry: semantic conventions and entity identity

Links:
- <https://opentelemetry.io/docs/concepts/semantic-conventions/>
- <https://opentelemetry.io/docs/specs/otel/entities/data-model/>

Relevant guidance:
- semantic conventions 的价值是跨代码库、库和平台采用共同命名方案。
- identifying attributes 应保持稳定，并遵循 minimally sufficient identity。
- 当某个 identity 已经承担 correlation / storage truth 时，不应把 display / descriptive meaning 混入同一字段。

Implication for this repo:
- `Phase 2-3` 的主要成果正是把 raw runtime identity 与 family/display vocabulary 拆开。
- 这意味着 `selected_target` 和 runtime package/import name 现在更像“identity / implementation truth”，而不是 UI-facing family truth。
- 如果继续 rename，必须证明新的 identity 更稳定、更值得成为 canonical implementation truth；否则更合理的做法是保持 identity 稳定，并把 family label 继续留在 projection / docs / routing vocabulary 层。

### Python PEP 387: Backwards Compatibility Policy

Link:
- <https://peps.python.org/pep-0387/>

Relevant guidance:
- incompatible changes 应有足够大的 benefit-to-breakage ratio，且受影响代码应容易修复。
- soft deprecation 适用于“不再推荐新代码使用，但 existing code 继续安全保留”的场景。

Implication for this repo:
- 虽然本 repo 不是 Python stdlib，但 `packages/rag-specialist` / `campus_rag_specialist` 已成为 repo 内广泛依赖的 workspace/public-ish import surface。
- 如果 rename 的收益只是命名一致，而 breakage 面覆盖 package dir、distribution name、module import、docs、tests、planning、release evidence，那么 benefit-to-breakage ratio 很可能不足。
- 更符合这一原则的候选结论是：
  - 保留 existing package/import naming 作为 stable implementation truth
  - 将其视为“soft deprecated for new naming decisions”，即 future family 继续使用 `*-agent`
  - 不再为现有 family 强推 repo-wide rename

## Local Evidence

### Current rename surface is large

Local counts on 2026-04-21:

- `packages/rag-specialist` path references: `359`
- `packages/navigation-specialist` path references: `28`
- `campus_rag_specialist` import/module references: `323`
- `campus_navigation_specialist` import/module references: `15`
- `rag-specialist` runtime/doc/test label references: `1094`
- `navigation-specialist` runtime/doc/test label references: `162`

These counts mean:

- `rag-specialist` rename is not a cosmetic patch; it is a repo-wide structural rewrite.
- `navigation-specialist` has a smaller blast radius, but renaming only navigation would create a new asymmetry and violate the “no half migration” rule.

### Existing workspace metadata is still specialist-shaped

Evidence:
- `packages/rag-specialist/pyproject.toml`
- `packages/navigation-specialist/pyproject.toml`

Current truth:
- distribution names are `campus-rag-specialist` / `campus-navigation-specialist`
- wheel packages are `src/campus_rag_specialist` / `src/campus_navigation_specialist`

This means a full rename would need to touch:

- workspace package directories
- `pyproject.toml` project names
- `tool.hatch.build.targets.*`
- import paths across apps/packages/tests
- repo docs and planning truth

### Runtime package names are already separated from forward family labels

Evidence:
- `docs/architecture/current-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/target-architecture.md`

Current truth already says:

- current runtime/package truth can remain `rag-specialist` / `navigation-specialist`
- forward family labels are `rag-agent` / `navigation-agent`

This materially lowers the pressure to rename implementation surfaces immediately, because the external semantic ambiguity has already been addressed.

### Mixed package naming is tolerable if frozen explicitly

Evidence:
- `packages/campus-services-agent`
- `packages/notice-agent`
- `packages/rag-specialist`
- `packages/navigation-specialist`

Observation:
- the repo already contains both new `*-agent` family packages and older `*-specialist` implementation packages.
- that asymmetry is acceptable only if it is explicitly frozen as a deliberate architectural outcome, not left as an “unfinished migration.”

## Decision Space

### Option A: One-shot full rename

Meaning:
- rename package dirs, distributions, import paths, runtime helper names, tests, docs, planning references in a single wave

Assessment:
- chosen by user

Required constraints:
- must be one-shot, not partial
- must not use compatibility shim / dual naming bridge
- must include package dir, distribution name, import path, runtime helper, tests, docs, planning truth

### Rejected Alternatives

- no-rename
  - rejected because user has explicitly chosen rename consistency over preserving current implementation identity
- partial rename
  - rejected because it violates the repo’s no-half-migration rule and would create long-lived ambiguity

## Research Conclusion

尽管外部 guidance 更偏向谨慎处理稳定 identity，但在用户已明确选择 one-shot full rename 的前提下，正确的研究结论不再是“要不要 rename”，而是：

- 必须把 rename 约束成一次性、全量、无兼容层的结构性收口
- 必须把 blast radius 当作执行前置事实，而不是执行中再边改边看
- 必须在 execution phase 中把 package/import/runtime/docs/planning/test truth 一次性改完

因此本 phase 的前向结论是：

- **freeze one-shot full rename**
- **reject no-rename and partial rename**
- **enter execution only after full write-set and verification surface are frozen**
