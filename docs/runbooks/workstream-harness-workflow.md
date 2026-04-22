---
doc_type: runbook
status: active
created: 2026-04-23
updated: 2026-04-23
---

# Workstream Harness Workflow

这套流程是 repo 内部默认的 agent execution entrypoint。
它复用现有 `workstream_claim` lease/heartbeat substrate，
但把默认执行路径提升为“持续执行直到目标态或真实 blocker”。

## First-Time Setup

先设置本机稳定 operator id：

```bash
uv run --all-packages python -m scripts.workstream_claim operator set <operator_id>
```

## Default Entry

交互式会话：

```bash
uv run --all-packages python -m scripts.workstream_harness codex shell <slug>
```

非交互执行：

```bash
uv run --all-packages python -m scripts.workstream_harness codex exec \
  <slug> -- "<task>"
```

常用诊断：

```bash
uv run --all-packages python -m scripts.workstream_harness status --current
uv run --all-packages python -m scripts.workstream_harness doctor
```

## Behavioral Rules

- harness 默认会先 claim workstream，再注入 session env 与 runtime ledger
- final answer 必须满足 `workstream_harness_result_v1`
- `Stop` hook 会拦截缺失或非法终态，并给一次 continuation 机会
- `PreToolUse` 会阻断明显 destructive 的 Bash 命令
- `PermissionRequest` 会把高风险升级请求转成显式 risk gate，
  而不是让 run 静默停住

## Runtime State

gitignored runtime 目录：

- `.planning/runtime/workstream-claims/`
- `.planning/runtime/workstream-claim-history.jsonl`
- `.planning/runtime/harness/runs/`
- `.planning/runtime/harness/events/`
- `.planning/runtime/harness/latest/`

## Escape Hatch

低层 claim/session 命令仍然保留，用于恢复和非 Codex runtime：

```bash
uv run --all-packages python -m scripts.workstream_claim session shell <slug>
uv run --all-packages python -m scripts.workstream_claim \
  session start <slug> -- <cmd...>
```

但它们不再是 repo 默认执行入口。
