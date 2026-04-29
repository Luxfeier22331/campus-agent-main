---
doc_type: requirements
status: active
created: 2026-04-21
updated: 2026-04-22
---

# Requirements: Repo-wide Codebase Decomposition

## Goal

把 repo 中已经明显超出可维护尺度的 handwritten production/test files 系统性拆解成更清晰的模块边界，
让后续功能 workstream 不再持续背着超大单文件推进。

## In Scope

- repo-wide oversized handwritten Python / TypeScript / JavaScript source files
- oversized handwritten test files
- phase-owned decomposition inventory 与 tranche mapping
- 在不改行为的前提下做 module split、helper extraction、test fixture extraction
- decomposition 后的 targeted verification 与 relevant lane verification
- inventory freeze 至少覆盖当前 worktree 中所有 `800+` 行的 handwritten code/test files；低于该阈值但已明确呈现 multi-owner monolith shape 的文件也可以显式 admission

## Non-goals

- vendor 目录拆分
- lockfile、Drizzle snapshot、其它 generated files 重写
- 借拆分之机修改业务语义、扩 scope、重写架构边界
- 把跨 domain 的功能改动伪装成 code cleanup
- 用一次性 compatibility shim 或临时双路径掩盖坏边界

## Success Criteria

1. 当前 inventory 中所有 `800+` handwritten code/test files，以及额外显式 admission 的 sub-800 multi-owner monolith files，都被映射进明确的后续 phase，不再停留在口头 backlog。
2. 每个 phase 都按模块边界拆分，而不是机械切行数。
3. 每个 tranche 的 code split 都保留现有行为，并有真实 targeted verification。
4. 每个 tranche 完成后，对应文件不再维持单个难以维护的 monolith owner shape。
5. 这条技术债以独立 workstream 承接，不反向污染 notice / ingestion / retrieval / product surfaces 等业务 workstream 的 phase 边界。

## Canonical Entry

- `.planning/workstreams/repo-wide-codebase-decomposition/README.md`
