---
doc_type: runbook
status: active
created: 2026-04-19
updated: 2026-04-19
---
# Workstream Claim Workflow

这套流程用于 repo 内部的 workstream 认领、会话级执行、handoff 和恢复。

它不改写 `.planning/WORKSTREAMS.md`、`.planning/workstreams/<slug>/STATE.md` 这些
tracked planning truth。 运行时 claim/operator/session 状态只写入 gitignored 的
`.planning/runtime/`。

## Runtime State Layout

- `.planning/runtime/operator.json`
  - 本机稳定 operator id 配置
- `.planning/runtime/workstream-claims/<slug>.json`
  - 当前 claim lease、owner、session key、handoff 状态
- `.planning/runtime/workstream-claims/<slug>.lock`
  - claim 读写锁文件
- `.planning/runtime/workstream-claim-history.jsonl`
  - claim acquire/release/handoff/takeover 审计历史

## First-Time Setup

先设置本机稳定 operator id：

```bash
uv run --all-packages python -m scripts.workstream_claim operator set \
  <operator_id>
```

可选查看或清理：

```bash
uv run --all-packages python -m scripts.workstream_claim operator get
uv run --all-packages python -m scripts.workstream_claim operator clear
```

## Normal Path

默认不要手工先 `claim` 再自己维护 lease。 正常执行入口固定是 wrapper-managed session：

```bash
uv run --all-packages python -m scripts.workstream_claim session shell <slug>
uv run --all-packages python -m scripts.workstream_claim session start <slug> \
  -- <cmd...>
```

`session shell` / `session start` 会自动执行：

1. 校验 `<slug>` 是原生 `.planning/workstreams/<slug>/` workstream
1. 获取 claim lease
1. 写入兼容原生 GSD 的 session-scoped active-workstream pointer
1. 注入 `GSD_WORKSTREAM`、`GSD_SESSION_KEY`、`GSD_OPERATOR_ID`、`CAMPUS_WORKSTREAM_CL
   AIM_ID`
1. 在子进程存活期间持续 heartbeat
1. 子进程退出后自动 release claim 并清理 pointer

当前会话上下文可用下面命令查看：

```bash
uv run --all-packages python -m scripts.workstream_claim session current
```

## Claim Inspection

```bash
uv run --all-packages python -m scripts.workstream_claim claim list
uv run --all-packages python -m scripts.workstream_claim claim status <slug>
uv run --all-packages python -m scripts.workstream_claim claim doctor
```

## Handoff And Recovery

发起交接：

```bash
uv run --all-packages python -m scripts.workstream_claim claim handoff <slug> \
  --to <operator_id> --note "<note>"
```

接收交接：

```bash
uv run --all-packages python -m scripts.workstream_claim claim accept <slug>
```

主动释放：

```bash
uv run --all-packages python -m scripts.workstream_claim claim release <slug> \
  --reason "<reason>"
uv run --all-packages python -m scripts.workstream_claim claim release \
  --current --reason "<reason>"
```

接管已过期或无人响应的 claim：

```bash
uv run --all-packages python -m scripts.workstream_claim claim takeover <slug> \
  --reason "<reason>"
uv run --all-packages python -m scripts.workstream_claim claim takeover <slug> \
  --force --reason "<reason>"
```

## Operational Rules

- tracked planning truth 继续写在 `.planning/WORKSTREAMS.md` 与
  `.planning/workstreams/<slug>/`
- 运行时认领状态不回写到 tracked markdown
- 同一条 workstream 只允许单 owner lease；不同 workstream 可以并行
- 若当前命令本身就是持续执行流程，优先使用 `session shell` 或 `session start`
- `claim release`、`claim handoff`、`claim accept`、`claim takeover` 只用于交接、恢复和异常处理
