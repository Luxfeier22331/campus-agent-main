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

plain `codex` / repo 内普通讨论会话：

- 不进入 harness terminal-result contract
- 不要求 `result write`
- 只继续复用 repo-wide 安全 hook

真正的执行会话：

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
- 只有 wrapper 注入了 harness env 的 session，才会消费 `SessionStart` / `Stop` 的终态 contract
- terminal result 必须满足 `workstream_harness_result_v1`
- canonical transport 是 result artifact side channel，不是用户可见 final answer：

```bash
uv run --all-packages python -m scripts.workstream_harness result write \
  --result completed \
  --summary "string" \
  --verification-status passed \
  --verification-command "pnpm web:lint" \
  --verification-notes "string" \
  --next-action "string"
```

- result artifact 里写入的 canonical payload 形状如下：

```json
{
  "schema_version": "workstream_harness_result_v1",
  "result": "completed",
  "summary": "string",
  "verification": {
    "status": "passed",
    "commands": ["pnpm web:lint"],
    "notes": "string"
  },
  "blocker": null,
  "next_action": "string"
}
```

- 正常 closeout 时，final assistant message 应该保留给人看，不应再把这段 JSON 直接显示给用户
- stop hook 会兼容少量已观测到的新 agent 旧形状，例如：
  - `result: "success"`
  - `verification: [{ "command": "...", "result": "passed", "details": "..." }]`
- 兼容只发生在输入端；runtime ledger 仍然只保存 canonical v1 payload
- `Stop` hook 与 wrapper 都只从 `result_file` 解析终态
- 如果 `result_file` 缺失、非法或不可读，run 会被拦截或收口为 `failed_needs_repair`
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
- `.planning/runtime/harness/outputs/`

## Closeout Sequence

交互式 `codex shell` 的推荐收口顺序：

1. 完成人类可读的最终说明。
2. 运行 `scripts.workstream_harness result write ...` 写入 terminal result artifact。
3. 正常结束会话；如果 `Stop` hook 未持久化，shell wrapper 也会在退出时用同一 artifact 完成最终收口。

非交互 `codex exec` 也遵循同一 contract；`assistant-message.txt` 只保留为审计 artifact，不再参与 terminal result 解析。

## Escape Hatch

低层 claim/session 命令仍然保留，用于恢复和非 Codex runtime：

```bash
uv run --all-packages python -m scripts.workstream_claim session shell <slug>
uv run --all-packages python -m scripts.workstream_claim \
  session start <slug> -- <cmd...>
```

但它们不再是 repo 默认执行入口。
