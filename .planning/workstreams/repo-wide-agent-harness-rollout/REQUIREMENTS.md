---
doc_type: requirements
status: retired
created: 2026-04-23
updated: 2026-06-04
---

# Requirements: Repo-wide Agent Harness Rollout

## Goal

记录旧 repo-owned agent execution harness 的退役边界。
当前 repo 不再要求、维护或恢复旧 harness；workstream registry 由 GSD SDK 管理，
执行现场由 Codex 原生会话承担。

## In Scope

- 保留 historical closeout 入口
- 明确旧 harness 不再是 current workflow
- 防止旧 wrapper、hook、terminal-result、claim lease、heartbeat ledger 被重新引入

## Non-goals

- 定义新的 workstream workflow；当前入口见 `docs/runbooks/workstream-gsd-sdk-workflow.md`
- 恢复旧 repo-owned harness runtime
- 维护旧 terminal-result schema 或 wrapper command
- 向 tracked planning 写入本地 session/runtime ledger

## Success Criteria

1. repo 不再包含旧 harness scripts/tests/runbooks/schema。
2. repo docs 指向 GSD SDK + Codex native workflow。
3. retired workstream 不再保留可复制的旧 wrapper command、hook contract 或 runtime ledger
   作为 current requirement。
4. local active Codex hook 配置不指向 repo-owned harness。

## Canonical Entry

- `.planning/workstreams/repo-wide-agent-harness-rollout/README.md`
