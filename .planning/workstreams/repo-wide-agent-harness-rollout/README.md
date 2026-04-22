---
doc_type: index
status: active
created: 2026-04-23
updated: 2026-04-23
---

# Workstream: Repo-wide Agent Harness Rollout

这是 `repo-wide-agent-harness-rollout` 的 native workstream 入口。
它负责 repo 级 agent 执行 harness、Codex 首发适配、runtime ledger 与默认执行入口切换，
不承接任何产品 runtime 语义，也不复用产品侧 `approval_required`。

## Current Status

- status: `active`
- current phase: `Phase 2`
- current focus: `workstream_harness` wrapper、repo-local Codex hooks、
  result schema 与 runtime ledger 已落地；
  当前继续收口默认入口切换、真实 run evidence
  与后续非-Codex adapter 边界

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`
