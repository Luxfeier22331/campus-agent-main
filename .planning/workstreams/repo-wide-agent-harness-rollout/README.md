---
doc_type: index
status: retired
created: 2026-04-23
updated: 2026-06-04
---

# Workstream: Repo-wide Agent Harness Rollout

这是 `repo-wide-agent-harness-rollout` 的 retired native workstream 入口。
它曾负责 repo 级 agent execution harness、Codex 首发适配、runtime ledger 与默认执行入口切换。
该 repo-owned harness 已在 2026-06-04 从当前执行面移除；当前 workstream 操作由
GSD SDK 与 Codex 原生会话承担。

## Current Status

- status: `retired`
- retirement date: `2026-06-04`
- current execution path: `docs/runbooks/workstream-gsd-sdk-workflow.md`
- reopen rule: do not restore the old repo-owned harness, hook injection, terminal-result
  artifact, claim lease, heartbeat ledger, or wrapper command path

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
