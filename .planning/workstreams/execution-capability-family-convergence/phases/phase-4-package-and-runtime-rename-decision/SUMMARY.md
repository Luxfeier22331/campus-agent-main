---
phase: "4"
name: "Package And Runtime Rename Decision"
created: 2026-04-21
updated: 2026-04-21
status: completed
---

# Phase 4 Summary

## What Closed

- `Phase 4` 已把 one-shot full rename 冻结为唯一前向方向；不再保留 no-rename 或 partial rename 分支。
- full rename 的 canonical write set 已经写死，必须同波次覆盖：
  - workspace package dir
  - Python distribution name
  - Python module / import path
  - raw runtime target value
  - runtime helper / delegate / public symbol naming
  - active docs / active planning / active tests
- `selected_target` / `selectedTarget` 的语义保持不变：
  - 它继续只表示 raw runtime target
  - 后续 Phase 5 如改 raw target value，也不能把它重新混成 capability family / display label 字段
- compatibility shim、dual naming alias、长期半迁移状态已被正式拒绝。
- `Phase 4` 同时量化了 rename blast radius，证明这不是 cosmetic cleanup，而是需要单独 execution phase 的 repo-wide structural cutover。

## Fresh Evidence

- `.planning/workstreams/execution-capability-family-convergence/phases/phase-4-package-and-runtime-rename-decision/CONTEXT.md`
- `.planning/workstreams/execution-capability-family-convergence/phases/phase-4-package-and-runtime-rename-decision/RESEARCH.md`
- `.planning/workstreams/execution-capability-family-convergence/phases/phase-4-package-and-runtime-rename-decision/PLAN.md`
- `packages/rag-specialist/pyproject.toml`
- `packages/navigation-specialist/pyproject.toml`
- `packages/supervisor-core/src/campus_supervisor_core/agent.py`
- `packages/contracts/src/campus_contracts/models.py`
- `tests/test_workspace_layout.py`

## Local Blast Radius Evidence

- `packages/rag-specialist` path refs: `359`
- `packages/navigation-specialist` path refs: `28`
- `campus_rag_specialist` import/module refs: `323`
- `campus_navigation_specialist` import/module refs: `15`
- `rag-specialist` runtime/doc/test label refs: `1094`
- `navigation-specialist` runtime/doc/test label refs: `162`

## External Grounding

- OpenAI `A practical guide to building agents`
  - well-defined work 应优先走明确 workflow 与清晰动作；因此 rename 既然被 admission，就应该写成 deterministic one-shot cutover，而不是留成反复回补的模糊迁移
  - link: <https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/>
- Anthropic `Building effective agents`
  - 建议优先采用简单、可组合的模式；因此如果执行 rename，就应避免 compatibility bridge 造成的双路径复杂度
  - link: <https://www.anthropic.com/engineering/building-effective-agents>
- OpenTelemetry semantic conventions
  - 共用命名方案的价值在于跨代码库的一致性；因此若 current runtime identity 要改名，observability / operator-facing active truth 也必须同波次跟上
  - link: <https://opentelemetry.io/docs/concepts/semantic-conventions/>
- Python PEP 387
  - incompatible change 需要足够高的 benefit-to-breakage ratio；因此 repo 不应多次序列化 breaking rename，而应一次性收口
  - link: <https://peps.python.org/pep-0387/>

## Handoff

- `Phase 4` 已正式 completed。
- 下一步进入 `Phase 5: One-Shot Full Rename Execution`。
- `Phase 5` 的任务不是再次讨论要不要 rename，而是按已冻结 write set 完成 code/doc/test/planning 的单波次 cutover，并用 targeted verification 证明 active canonical truth 不再残留 `*-specialist` / `*-agent` 双命名。
