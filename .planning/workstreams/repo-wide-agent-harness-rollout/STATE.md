---
workstream: repo-wide-agent-harness-rollout
created: 2026-04-23
updated: 2026-04-23
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** 3
**Current Phase Name:** Default Entry Cutover And Real Run Acceptance
**Current Plan:** baseline 已直接落地到 repo code/docs；
当前不另建 phase-local PLAN，
继续以本 worktree 的 harness runtime/test/doc truth 为准
**Total Phases:** 4
**Total Plans in Phase:** 0
**Progress:** 2/4 phases complete
**Last Activity:** 2026-04-23
**Last Activity Description:** Added `workstream_harness` wrapper,
Codex hooks, result schema, runtime ledger, tests,
and started cutting the repo default entrypoints
over from raw claim sessions to harness-managed sessions.

## Current Slice

- completed `Phase 1` truth:
  - final result schema 固定为 `workstream_harness_result_v1`
  - terminal results 固定为 `completed / blocked / failed_needs_repair`
  - blocker kinds 固定为 `external_input / decision_required / risk_gate /
    environment_missing / policy_denied`

- completed `Phase 2` truth:
  - `scripts/workstream_harness.py` 已落地 `codex shell` / `codex exec` /
    `status` / `doctor`
  - `.codex/hooks.json` 与
    `SessionStart / PreToolUse / PermissionRequest / Stop`
    hook wrappers 已落地
  - `.planning/runtime/harness/` 已成为 gitignored run/event/latest ledger
  - Python tests 已覆盖 result parsing、hooks 与 wrapper baseline

- current `Phase 3` focus:
  - README / CONTRIBUTING / AGENTS / runbook 默认入口切换
  - `WORKSTREAMS.md` / `PROJECT.md` 的 repo truth refresh
  - 至少一轮真实 harness run evidence 与 doctor continuity

## Blockers

- 当前只实现 Codex adapter；非 Codex runtime 仍未接入。
- interactive `codex shell` 的 terminal result 主要依赖 Stop hook 持久化，
  而不是 wrapper 自己读取 session transcript。
- repo 还缺一轮真实 acceptance evidence，
  用于确认“默认不再在局部里程碑处停下”。

## Verification

- 需要稳定通过的本轮验证：
  - `uv run --all-packages python -m unittest tests.test_workstream_claim tests.test_workstream_harness`
  - `uv run --all-packages ruff check scripts/workstream_harness.py \
    scripts/workstream_harness_result.py scripts/workstream_harness_runtime.py \
    scripts/workstream_harness_hooks.py tests/test_workstream_harness.py`

## Session Continuity

**Stopped At:** wrapper / hooks / schema / runtime ledger baseline 已经落地，
下一次恢复应先完成 docs + planning truth cutover，
然后做一次真实 harness run smoke。
**Resume File:** README.md
