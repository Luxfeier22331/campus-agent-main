---
phase: "5"
name: "One-Shot Full Rename Execution"
created: 2026-04-21
updated: 2026-04-21
status: planned
---

# Phase 5 Context

**Gathered:** 2026-04-21
**Status:** Planned

<domain>
## Phase Boundary

本 phase 只负责执行已经在 `Phase 4` admitted 的 one-shot full rename：

- `packages/rag-specialist -> packages/rag-agent`
- `packages/navigation-specialist -> packages/navigation-agent`
- `campus-rag-specialist -> campus-rag-agent`
- `campus-navigation-specialist -> campus-navigation-agent`
- `campus_rag_specialist -> campus_rag_agent`
- `campus_navigation_specialist -> campus_navigation_agent`
- raw runtime target：
  - `rag-specialist -> rag-agent`
  - `navigation-specialist -> navigation-agent`

它还负责同波次更新：

- public-ish runtime helper / delegate / class naming
- active docs / active planning / active tests / active READMEs / active AGENTS
- operator / observability / panel / app-api 中仍承载 raw runtime target 的 active code surface

它不负责：

- 重开 `Phase 1-4` 的 terminology / contract / wording 决策
- 新增 capability family 或重做 `campus-services-agent` / `notice-agent` 的边界
- 引入 compatibility shim、dual naming alias、temporary wrapper
- 处理 historical archive 里只用于回溯历史状态的文件，除非它们仍被 active canonical truth 引用
- 重新引入 `availability-specialist`

</domain>

<current_truth>
## Current Truth

- `Phase 4` 已完成：
  - one-shot full rename 已被固定为唯一前向方案
  - `selected_target` / `selectedTarget` 继续只表示 raw runtime target
  - raw runtime target 的 value 如进入 rename，也只能在保持上述语义不变的前提下执行
- 当前 repo 中仍存在大量 legacy implementation identity：
  - workspace dir：`packages/rag-specialist`、`packages/navigation-specialist`
  - Python distribution：`campus-rag-specialist`、`campus-navigation-specialist`
  - Python module：`campus_rag_specialist`、`campus_navigation_specialist`
  - raw runtime target：`rag-specialist`、`navigation-specialist`
- 更晚落下的 family 已经直接使用 `*-agent`：
  - `packages/campus-services-agent`
  - `packages/notice-agent`
- local audit 已确认 rename blast radius 跨越：
  - contracts / supervisor / evals / apps / tests / docs / planning truth
  - 不只是 package dir 或 import path 的局部修补

</current_truth>

<decisions>
## Locked Decisions

- **05-01:** 本 phase 执行 one-shot full rename，不再保留 decision gate。
- **05-02:** rename 必须是单波次 cutover；任一 active canonical surface 不能切，就不应开始执行。
- **05-03:** `selected_target` / `selectedTarget` 的字段语义不变，但其 raw runtime target value 进入本 phase write set。
- **05-04:** active canonical truth 必须全部改到 `*-agent`；historical archive 仅在继续冒充 current truth 时才进入 write set。
- **05-05:** `campus-services-agent`、`notice-agent` 不回退；本 phase 只处理 legacy `rag` / `navigation` families。
- **05-06:** `packages/rag-specialist/src/campus_rag_specialist/service.py` 是局部高耦合文件；实现时需要围绕它组织 cutover，避免并发冲突。

</decisions>

<specifics>
## Concrete Rename Surface

- workspace / packaging
  - `packages/rag-specialist/`
  - `packages/navigation-specialist/`
  - `packages/supervisor-core/pyproject.toml`
  - 其他 workspace package 对 `campus-rag-specialist` / `campus-navigation-specialist` 的依赖引用
- Python import / symbol
  - `campus_rag_specialist` / `campus_navigation_specialist`
  - `RagSpecialistAgent`
  - `delegate_to_navigation_specialist`
  - `_delegate_to_rag_specialist`
- raw runtime target
  - `packages/contracts/src/campus_contracts/models.py`
  - `packages/supervisor-core/src/campus_supervisor_core/{agent,audit,framing,response,routing,tool_policy}.py`
  - app-api / protected-panel-web / evals / tests 中的 `rag-specialist`、`navigation-specialist`
- active docs / planning
  - `docs/architecture/current-architecture.md`
  - `docs/architecture/system/execution-and-agents-architecture.md`
  - `docs/architecture/target-architecture.md`
  - active workstream docs 与 repo entry docs

</specifics>

<canonical_refs>
## Canonical References

- `.planning/workstreams/execution-capability-family-convergence/REQUIREMENTS.md`
- `.planning/workstreams/execution-capability-family-convergence/ROADMAP.md`
- `.planning/workstreams/execution-capability-family-convergence/STATE.md`
- `.planning/workstreams/execution-capability-family-convergence/phases/phase-4-package-and-runtime-rename-decision/SUMMARY.md`
- `docs/plans/execution-capability-family-convergence.md`
- `docs/architecture/current-architecture.md`
- `docs/architecture/system/execution-and-agents-architecture.md`
- `docs/architecture/target-architecture.md`
- `packages/contracts/src/campus_contracts/models.py`
- `packages/supervisor-core/src/campus_supervisor_core/agent.py`
- `packages/supervisor-core/pyproject.toml`
- `packages/rag-specialist/AGENTS.md`
- `tests/test_workspace_layout.py`

</canonical_refs>

<deferred>
## Deferred Follow-up

- historical archive 的全量术语清扫不属于本 phase，除非 active docs 仍直接依赖这些历史文件作为 current-truth 入口
- future capability family 的命名扩展不属于本 phase；它们继续服从已经冻结的 `*-agent` rule

</deferred>
