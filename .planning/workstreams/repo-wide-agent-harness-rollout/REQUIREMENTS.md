---
doc_type: requirements
status: active
created: 2026-04-23
updated: 2026-04-23
---

# Requirements: Repo-wide Agent Harness Rollout

## Goal

为整个仓库建立 repo-owned agent execution harness，
让默认执行路径从“做到一半就停下来问”收口到“持续执行直到目标态或真实 blocker”，
同时保持 workstream claim/runtime state 继续停留在 gitignored `.planning/runtime/`。

## In Scope

- vendor-neutral harness contract
- Codex first-party adapter 与 repo-local hooks
- `workstream_claim` 之上的 harness wrapper / runtime ledger
- default entrypoint 从 raw claim session 切到 harness wrapper
- blocker taxonomy、verification-before-stop 与 risk gate 语义
- repo-level docs / planning truth refresh

## Non-goals

- 产品侧审批流、panel `approval_required` 或 operator action state machine
- Claude / Gemini / Cursor 等其他 agent 的首发接入
- 把运行时 lease / claim history 写回 tracked planning markdown
- 对产品 runtime、retrieval/data plane 或 auth 语义做任何扩 scope

## Success Criteria

1. repo 中存在独立 native workstream，
   明确把 harness engineering 定义为 repo-wide execution infrastructure，
   而不是任一产品线的附属 follow-up。
2. repo 有默认可执行入口：
   `uv run --all-packages python -m scripts.workstream_harness codex shell <slug>`
   与 `codex exec <slug> -- "<task>"`。
3. `scripts/workstream_claim.py` 继续作为底层 lease/claim substrate；
   harness 不重写 claim truth。
4. repo-local Codex hooks 能在
   `SessionStart / PreToolUse / PermissionRequest / Stop`
   上提供真实约束。
5. final result 采用稳定的机器可读 schema，
   并区分 `completed / blocked / failed_needs_repair`。
6. 有 tracked 改动的 run 不能在未给出合法 verification 状态的情况下合法结束。
7. harness runtime ledger 只写入 gitignored `.planning/runtime/harness/`。
8. README / CONTRIBUTING / AGENTS / runbook 的默认执行入口
   已切到 harness wrapper。
9. 真实 Python 测试覆盖 result parsing、hook enforcement、
   runtime ledger 与 wrapper command path。

## Canonical Entry

- `.planning/workstreams/repo-wide-agent-harness-rollout/README.md`
