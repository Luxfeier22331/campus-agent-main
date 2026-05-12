---
doc_type: reference
status: active
created: 2026-04-23
updated: 2026-04-25
---

# Workstream Agent Harness Contract

这个 contract 定义 repo-wide execution harness 的终态、
blocker 和 verification 语义。
它只服务开发执行流程，不是产品 runtime contract。

## Scope

- 适用于 repo 内通过 harness wrapper 运行的 agent session
- 运行时状态只写入 gitignored `.planning/runtime/harness/`
- 不复用产品侧 `approval_required`
- Codex hooks 由 `scripts.workstream_harness` wrapper 在启动 Codex 时通过 runtime config
  显式注入；repo 不再依赖本机 `.codex/hooks.json` 作为默认入口
- `SessionStart` / `PreToolUse` / `PermissionRequest` / `Stop` 的 harness
  contract 只属于 wrapper 启动的 harness session
- 普通 repo 讨论会话不消费 terminal result contract，也不应默认加载 repo harness hooks

## Terminal Result Schema

terminal result 的 canonical schema 固定为一个机器可读 JSON 对象：

```json
{
  "schema_version": "workstream_harness_result_v1",
  "result": "completed",
  "summary": "string",
  "verification": {
    "status": "passed",
    "commands": ["pnpm web:test"],
    "notes": "string"
  },
  "blocker": null,
  "next_action": "string"
}
```

推荐直接复用这个最小模板，不要自定义 `success`、`verification[]` 之类的旧形状。

## Terminal Result Transport

canonical transport 不是“把 JSON 直接显示给用户”，而是写入 gitignored runtime result artifact。

默认写入方式：

```bash
uv run --all-packages python -m scripts.workstream_harness result write \
  --result completed \
  --summary "string" \
  --verification-status passed \
  --verification-command "pnpm web:lint" \
  --verification-notes "string" \
  --next-action "string"
```

补充规则：

- `result write` 默认从当前 harness session env 读取：
  - `CAMPUS_WORKSTREAM_RUN_ID`
  - `CAMPUS_WORKSTREAM_REPO_ROOT`
  - `CAMPUS_WORKSTREAM_RESULT_PATH`
- `blocked` 必须额外提供：
  - `--blocker-kind`
  - `--blocker-message`
- shell / exec 都只读取 result artifact 来决定是否允许 stop 或 finalize run
- final assistant message 应该保留给人看，不再承担 terminal result transport

### `result`

- `completed`
  - 目标已完成，不再停留在局部子任务完成态
- `blocked`
  - 遇到真实外部 blocker，无法继续自解
- `failed_needs_repair`
  - 本轮执行未达到合法终态，需要恢复并修复

## Compatibility Normalization

harness 会在输入端归一化少量已观测到的新 agent 旧形状，但持久化到 runtime ledger 的 payload
仍然必须回写为 canonical `workstream_harness_result_v1`。

source precedence 已收口为单一 truth source：

1. `result_file`

如果 `result_file` 不存在、不可读或不可解析，hook / wrapper 会直接拒绝 stop 或把 run 记为
`failed_needs_repair`，不再静默回退到 message JSON。

当前受支持的旧形状输入：

- `result: "success"` / `"done"` / `"complete"`
  - 归一化为 `completed`
- `result: "failed"` / `"error"` / `"needs_repair"`
  - 归一化为 `failed_needs_repair`
- `verification` 为数组，元素形状类似：
  - `{ "command": "...", "result": "passed", "details": "..." }`
- `verification` 为对象但使用旧键：
  - `result` -> `status`
  - `command` -> `commands: [...]`
  - `details` -> `notes`

输入归一化的目标是适配 agent 新行为，不是放宽 canonical schema。
如果 payload 语义仍然不明确，hook 依旧会拒绝停止。

## Blocker Taxonomy

`blocked` 时必须提供：

- `external_input`
  - 需要验证码、人工登录、secret、人工验证
- `decision_required`
  - 存在高影响实现分支，repo truth 无法自动裁决
- `risk_gate`
  - 命中不可逆动作、部署、密钥轮换或 destructive op
- `environment_missing`
  - 缺 CLI、依赖、服务、运行时前置条件且当前会话无法补齐
- `policy_denied`
  - sandbox / hook / policy 明确拒绝且没有安全替代路径

## Verification

`verification.status` 只允许：

- `passed`
- `failed`
- `skipped`
- `not_applicable`

规则：

- 有 tracked 改动时，不允许以 `skipped` 结束 `completed`
- `completed` 只能配 `passed` 或 `not_applicable`
- `blocked` 必须给出 blocker，并且要明确下一步恢复动作
- `failed_needs_repair` 不能伪装成 blocker；如果真的是外部阻塞，应该改成 `blocked`

如果你需要手动构造 payload，保持下面的 canonical 形状：

```json
{
  "schema_version": "workstream_harness_result_v1",
  "result": "completed",
  "summary": "Implemented the requested change.",
  "verification": {
    "status": "passed",
    "commands": ["pnpm web:lint"],
    "notes": "Lint passed."
  },
  "blocker": null,
  "next_action": "Commit the isolated change if desired."
}
```

## Runtime Ledger

gitignored runtime ledger 固定在：

- `.planning/runtime/harness/runs/<run_id>.json`
- `.planning/runtime/harness/events/<run_id>.jsonl`
- `.planning/runtime/harness/latest/<workstream>.json`
- `.planning/runtime/harness/outputs/<run_id>.result.json`
- `.planning/runtime/harness/outputs/<run_id>.assistant-message.txt`

run ledger 会额外记录 `result_source`，用于区分本次终态来自：

- `result_file`
- `synthetic_failure`

这些文件和字段都不是 tracked planning truth，也不回写 `.planning/workstreams/<slug>/STATE.md`。

## Future Adapter Boundary

当前只实现 Codex adapter，但 future adapter contract 已固定：

- adapter 必须负责启动前注入：
  - `CAMPUS_WORKSTREAM_RUN_ID`
  - `CAMPUS_WORKSTREAM_REPO_ROOT`
  - `CAMPUS_WORKSTREAM_RESULT_PATH`
  - `CAMPUS_WORKSTREAM_HARNESS_MODE`
- adapter 可以额外保存自己的 assistant message / transcript artifact，但不得把它重新提升为
  terminal result source
- terminal result 必须写入 canonical result artifact，wrapper / hook 只认这一条通道
- 非 Codex runtime 如果不能消费 repo-local hook，也必须在 wrapper 退出前完成等价的
  result validation 与 run persistence

## Codex Hook Registration Boundary

Codex hook registration is adapter-owned:

- `scripts.workstream_harness codex shell|exec ...` 启动 Codex 时必须显式传入
  `--enable codex_hooks` 与 `-c hooks=...`
- hook command 直接从 repo root 执行
  `python -m scripts.workstream_harness_hooks <event>`，不再依赖 ignored
  `.codex/hooks/*.py` wrapper
- 本机若残留旧的 `.codex/hooks.json`，应删除；否则在用户全局开启 `codex_hooks`
  时，plain `codex` 也会加载 repo hook 并出现额外 hook 噪音
- `PreToolUse` 只作为 harness execution guardrail，不是 repo 的完整权限模型；
  wrapper/result artifact/stop validation 仍是终态 correctness 的主要 enforcement
