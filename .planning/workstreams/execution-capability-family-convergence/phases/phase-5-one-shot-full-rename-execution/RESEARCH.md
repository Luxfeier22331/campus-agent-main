---
phase: "5"
name: "One-Shot Full Rename Execution"
created: 2026-04-21
updated: 2026-04-21
status: planned
---

# Phase 5 Research

## Question

在 `Phase 4` 已经把 one-shot full rename admission 固定下来之后，repo 应如何执行这次 rename，才能既保持 raw runtime target 语义稳定，又避免活跃代码面与活跃文档面长期停在双命名状态？

## External References

### OpenAI: A practical guide to building agents

Link:
- <https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/>

Relevant guidance:
- well-defined work 更适合明确 workflow，而不是依赖隐式 agent improvisation
- instructions 应拆成清晰动作与边界，减少歧义
- manager pattern 适合由单一上层 owner 统一编排 specialized downstream work

Implication for this repo:
- rename execution 是 deterministic structural cutover，不应以“边改边看”的局部 patch 方式推进
- write set、顺序、验证面必须在 phase plan 中显式列出
- `supervisor` 作为 invariant top-level role name 不变；rename 只发生在 downstream family implementation identity

### Anthropic: Building effective agents

Link:
- <https://www.anthropic.com/engineering/building-effective-agents>

Relevant guidance:
- 优先采用简单、可组合的模式
- routing 要把输入导向 specialized follow-up task，并保持清晰分工
- 避免因为框架/抽象便利而无谓增加复杂度

Implication for this repo:
- 一旦已决定 rename，最简单的执行方式不是 compatibility bridge，而是 one-shot cutover
- `rag` / `navigation` rename 应一次性收口 active canonical truth，避免长期保留 `specialist` / `agent` 双路径

### Python PEP 387: Backwards Compatibility Policy

Link:
- <https://peps.python.org/pep-0387/>

Relevant guidance:
- incompatible changes 应有足够高的 benefit-to-breakage ratio
- public-ish name changes 不应反复多次打断下游代码
- soft deprecation 适合“不再推荐新代码使用，但 existing code 继续保留”的场景

Implication for this repo:
- `Phase 4` 已经拒绝 soft-deprecation 路线，用户也明确选择 full rename
- 因此正确执行姿势不是多轮 breaking rename，而是一次性切换后保持稳定

### OpenTelemetry: Semantic Conventions

Link:
- <https://opentelemetry.io/docs/concepts/semantic-conventions/>

Relevant guidance:
- 共同命名方案的价值在于跨代码库、库和平台的一致性

Implication for this repo:
- raw runtime target 如果进入 rename，observability / operator / trace-facing active code 也必须同波次更新
- 否则 current runtime identity 与 display/system wording 会重新分叉

## Local Evidence

### Rename blast radius crosses code, contracts, apps, and docs

Local counts on 2026-04-21:

- `packages/rag-specialist` path refs: `359`
- `packages/navigation-specialist` path refs: `28`
- `campus_rag_specialist` import/module refs: `323`
- `campus_navigation_specialist` import/module refs: `15`
- `rag-specialist` runtime/doc/test label refs: `1094`
- `navigation-specialist` runtime/doc/test label refs: `162`

Meaning:

- rename 涉及 package identity、raw runtime target 与 operator/doc truth 三个层面
- 不能把它误判成单纯的 filesystem rename

### Raw runtime target is code-owned, not docs-only

Evidence:

- `packages/contracts/src/campus_contracts/models.py`
- `packages/supervisor-core/src/campus_supervisor_core/{agent,audit,framing,response,routing,tool_policy}.py`
- `apps/app-api/src/modules/runtime-command/service/normalize.ts`
- `apps/protected-panel-web/src/panel/requests/request-formatters.ts`

Meaning:

- `rag-specialist` / `navigation-specialist` 不是只有文档和测试里提到的旧词
- 它们是 current runtime dispatch / operator filtering / panel display 的 active code truth

### Workspace packaging surfaces are explicitly specialist-shaped

Evidence:

- `packages/rag-specialist/pyproject.toml`
- `packages/navigation-specialist/pyproject.toml`
- `packages/supervisor-core/pyproject.toml`
- `tests/test_workspace_layout.py`

Meaning:

- 执行 rename 时必须一起更新：
  - workspace directory
  - distribution dependency names
  - `src/<module>` layout
  - workspace layout tests

### Historical archive should not dominate execution scope

Evidence:

- current repo contains active planning truth under `.planning/workstreams/`
- historical archive still lives under `.planning/legacy-flat/` and `docs/plans/archive/`

Meaning:

- execution scope 应首先收口 active canonical truth
- historical archive 只有在继续冒充 current truth 或被 active docs 直接依赖时才需要进入 write set

## Research Conclusion

`Phase 5` 的正确执行模型是：

1. 先切 workspace/package metadata：
   - package dir
   - distribution name
   - module import root
2. 同波次切 raw runtime target：
   - contracts enum/value
   - supervisor routing / audit / tool-policy / response shaping
   - app-api / protected-panel-web / evals / tests
3. 同波次切 public-ish symbol naming：
   - delegate / class / helper / README / AGENTS
4. 同波次更新 active docs / active planning
5. 用 targeted Python + JS/TS verification 证明 cutover 后 active canonical truth 不再混名

拒绝：

- no-rename
- partial rename
- compatibility shim
- 把 archive 历史文件当作 execution 的第一优先级
