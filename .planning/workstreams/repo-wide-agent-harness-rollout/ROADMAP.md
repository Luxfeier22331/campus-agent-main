---
doc_type: roadmap
status: active
created: 2026-04-23
updated: 2026-04-23
---

# Roadmap: Repo-wide Agent Harness Rollout

## Overview

这条 workstream 负责 repo 级 agent harness 的 contract、
Codex 首发适配、默认入口切换与 acceptance closeout。
它不改写产品 workstream 的 phase 顺序，只为所有 workstream 提供统一执行基座。

## Phases

- [x] **Phase 1: Harness Contract And Codex Result Schema Freeze**
  — 冻结 `completed / blocked / failed_needs_repair` 终态、
  blocker taxonomy、verification-before-stop 规则与 final result schema。
- [x] **Phase 2: Codex Wrapper, Hooks, And Runtime Ledger Baseline**
  — 落地 `scripts/workstream_harness.py`、repo-local `.codex/hooks.json`、
  runtime ledger 与基础测试。
- [x] **Phase 3: Default Entry Cutover And Real Run Acceptance**
  — 把 README / CONTRIBUTING / AGENTS 的默认入口切到 harness wrapper，
  并补一轮真实 run evidence / doctor continuity。
- [x] **Phase 4: Future Adapter Boundary And Closeout**
  — 冻结非-Codex adapter 的边界、escape hatch 语义与 reopen rule，
  不在首发阶段提前实现第二家 adapter。
