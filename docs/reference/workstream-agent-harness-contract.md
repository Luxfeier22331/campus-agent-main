---
doc_type: reference
status: active
created: 2026-04-23
updated: 2026-04-23
---

# Workstream Agent Harness Contract

这个 contract 定义 repo-wide execution harness 的终态、
blocker 和 verification 语义。
它只服务开发执行流程，不是产品 runtime contract。

## Scope

- 适用于 repo 内通过 harness wrapper 运行的 agent session
- 运行时状态只写入 gitignored `.planning/runtime/harness/`
- 不复用产品侧 `approval_required`

## Terminal Result

final result 必须携带一个机器可读 JSON 对象：

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

### `result`

- `completed`
  - 目标已完成，不再停留在局部子任务完成态
- `blocked`
  - 遇到真实外部 blocker，无法继续自解
- `failed_needs_repair`
  - 本轮执行未达到合法终态，需要恢复并修复

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

## Runtime Ledger

gitignored runtime ledger 固定在：

- `.planning/runtime/harness/runs/<run_id>.json`
- `.planning/runtime/harness/events/<run_id>.jsonl`
- `.planning/runtime/harness/latest/<workstream>.json`

它不是 tracked planning truth，也不回写 `.planning/workstreams/<slug>/STATE.md`。
