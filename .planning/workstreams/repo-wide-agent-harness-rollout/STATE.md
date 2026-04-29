---
workstream: repo-wide-agent-harness-rollout
created: 2026-04-23
updated: 2026-04-23
---

# Project State

## Current Position

**Status:** Completed
**Current Phase:** 4
**Current Phase Name:** Future Adapter Boundary And Closeout
**Current Plan:** baseline 已直接落地到 repo code/docs；
当前不另建 phase-local PLAN，
继续以本 worktree 的 harness runtime/test/doc truth 为准
**Total Phases:** 4
**Total Plans in Phase:** 0
**Progress:** 4/4 phases complete
**Last Activity:** 2026-04-23
**Last Activity Description:** Closed the harness rollout:
artifact-only terminal-result transport is enforced,
`codex exec` no longer emits JSONL event mode by default,
exec prompt parsing now accepts options after `<slug>`,
repo docs were aligned, and two real acceptance-smoke runs
completed through the wrapper with `result_source=result_file`.

## Current Slice

- completed `Phase 1` truth:
  - final result schema 固定为 `workstream_harness_result_v1`
  - terminal results 固定为 `completed / blocked / failed_needs_repair`
  - blocker kinds 固定为 `external_input / decision_required / risk_gate /
    environment_missing / policy_denied`

- completed `Phase 2` truth:
  - `scripts/workstream_harness.py` 已落地 `codex shell` / `codex exec` /
    `status` / `doctor` / `result write`
  - `.codex/hooks.json` 与
    `SessionStart / PreToolUse / PermissionRequest / Stop`
    hook wrappers 已落地
  - `.planning/runtime/harness/` 已成为 gitignored run/event/latest ledger
  - Python tests 已覆盖 result parsing、hooks 与 wrapper baseline

- completed `Phase 3` truth:
  - README / CONTRIBUTING / AGENTS / runbook 默认入口已切到 harness wrapper
  - 已完成两轮真实 `workstream_harness codex exec` acceptance smoke
  - 最新 runtime ledger 已确认 `result_source=result_file`、
    `state=completed`、claim release 正常

- completed `Phase 4` truth:
  - terminal result transport 已收口为 artifact-only
  - future adapter boundary / escape hatch 语义已冻结到 contract
  - `codex exec` 默认不再开启 JSONL event mode
  - exec prompt parsing 已兼容 `codex exec <slug> --option ... -- "<task>"`

## Blockers

- 当前无 active blocker；后续只在 reopen 条件触发时恢复。

## Verification

- 需要稳定通过的本轮验证：
  - `uv run --all-packages python -m unittest tests.test_workstream_harness`
  - `uv run --all-packages ruff check scripts/workstream_harness.py \
    scripts/workstream_harness_result.py scripts/workstream_harness_runtime.py \
    scripts/workstream_harness_hooks.py tests/test_workstream_harness.py`
  - `uv run --all-packages python -m scripts.workstream_harness codex exec \
    --operator-id codex --session-key acceptance-smoke \
    --skip-git-repo-check repo-wide-agent-harness-rollout -- "<prompt>"`
  - `uv run --all-packages python -m scripts.workstream_harness codex exec \
    repo-wide-agent-harness-rollout --operator-id codex \
    --session-key acceptance-smoke-2 --skip-git-repo-check -- "<prompt>"`

## Session Continuity

**Stopped At:** workstream 已完成；
只有在新增非-Codex adapter、改写 terminal-result contract、
或需要再次调整 repo 默认 execution entrypoint 时才应恢复。
**Resume File:** .planning/WORKSTREAMS.md
