---
phase: "4"
name: "Package And Runtime Rename Decision"
created: 2026-04-21
updated: 2026-04-21
status: planned
---

# Phase 4 Context

**Gathered:** 2026-04-21
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责：

- 冻结 `rag-specialist` / `navigation-specialist` 这类 legacy current-truth package/runtime label 需要执行 one-shot full rename
- 明确 package dir、distribution name、Python import path、runtime object label 在单波次内的迁移边界
- 明确哪些 surface 必须同波次完成，哪些 surface 不允许留下半迁移状态
- 把本次 full rename 写成正式 repo truth，而不是继续保持“以后可能改”的模糊状态

它不负责：

- 重开 `Phase 1-3` 已完成的 terminology / contract / wording 收口
- 再次修改 `selected_target` / `selectedTarget` 语义
- 增加双路径兼容层、temporary alias、过渡 wrapper 或“以后再删”的 rename shim
- 推进任何 domain workstream 的功能实现
- 重新引入 `availability-specialist`

</domain>

<current_truth>
## Current Truth

- `Phase 1` 已冻结前向 family naming：
  - `rag-specialist -> rag-agent`
  - `navigation-specialist -> navigation-agent`
  - `campus-services-agent`
  - `notice-agent`
- `Phase 2` 已冻结：
  - `selected_target` / `selectedTarget` 继续只表示 raw current runtime target
  - current serialized contract 不承载 forward family label
- `Phase 3` 已冻结：
  - prompt-facing wording 不再把 `rag-specialist` 当默认 persona
  - eval 已显式拆分 runtime target 与 capability family
  - observability / operator wording 已固定 raw target 与 derived label 分层
- 当前 merged truth 里仍存在 legacy package/runtime surface：
  - workspace package dir：`packages/rag-specialist`、`packages/navigation-specialist`
  - Python distribution：`campus-rag-specialist`、`campus-navigation-specialist`
  - Python import/module：`campus_rag_specialist`、`campus_navigation_specialist`
  - runtime delegate/object：`delegate_to_rag_agent` 与 `delegate_to_navigation_specialist` 等仍挂在 legacy package/import 名下
- 其他较新的 family 已直接以 `*-agent` package naming 落下：
  - `packages/campus-services-agent`
  - `packages/notice-agent`

</current_truth>

<decisions>
## Planning Decisions

- **04-01:** 用户已明确选择 one-shot full rename；`Phase 4` 不再保留 no-rename 分支。
- **04-02:** rename 候选面必须拆开评估，至少区分：
  - package dir
  - Python distribution name
  - Python import/module name
  - runtime object / helper / delegate naming
  - docs / planning references
- **04-03:** 不接受“半迁移长期存在”：
  - 不能只改一部分 package dir 而把 import/runtime/doc surface 长期悬空
  - 不能引入双出口 alias / compatibility shim 充当长期真相
- **04-04:** full rename 必须一次性收口所有 repo-owned canonical truth，并为 tests / docs / planning / workspace metadata 提供完整 write set。
- **04-05:** 任何只改 docs、只改 import、只改 package dir、只改 runtime helper 的局部 rename 都视为失败方案。
- **04-06:** availability 删除线不属于本 phase 输入；`Phase 4` 只消费已经收口后的 current truth。

</decisions>

<specifics>
## Concrete Gaps

- repo 目前已经把 family vocabulary 与 current runtime contract 分层，但 full rename 的具体 write set 和 sequencing 还未冻结。
- `packages/rag-specialist` / `campus_rag_specialist` 在 repo 内耦合面很大；如果不先量化，很容易误判 rename 成本。
- `navigation-specialist` 的当前产品路径处于 fail-close / deferred 状态；这会影响 full rename 的执行顺序与验证面，但不再改变是否迁移的结论。
- repo 当前明确禁止 temporary compatibility layer；这意味着一旦迁移，必须是单波次结构性收口，而不是逐步 alias。

</specifics>

<canonical_refs>
## Canonical References

- `.planning/workstreams/execution-capability-family-convergence/REQUIREMENTS.md`
- `.planning/workstreams/execution-capability-family-convergence/ROADMAP.md`
- `.planning/workstreams/execution-capability-family-convergence/STATE.md`
- `.planning/workstreams/execution-capability-family-convergence/phases/phase-3-prompt-eval-and-observability-label-convergence/SUMMARY.md`
- `docs/plans/execution-capability-family-convergence.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/execution-and-agents-architecture.md`
- `docs/architecture/target-architecture.md`
- `packages/rag-specialist/pyproject.toml`
- `packages/navigation-specialist/pyproject.toml`
- `packages/supervisor-core/src/campus_supervisor_core/agent.py`
- `tests/test_workspace_layout.py`

</canonical_refs>

<deferred>
## Deferred Follow-up

- `Phase 4` 已冻结为 one-shot full rename；执行应进入后续 implementation phase，而不是在本 planning phase 内直接动手
- 任何 `selected_target` / `selectedTarget` contract enum 变更都不属于本 phase

</deferred>
