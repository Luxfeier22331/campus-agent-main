---
doc_type: index
status: completed
created: 2026-05-02
updated: 2026-05-02
---
# Workstream: Regulation RAG Release Lane

这是 `regulation-rag-release-lane` 的 native workstream 入口。

这条线负责把 notice-derived / canonical regulation document 从“已进入文档站或
registry”推进到“下游 RAG 可检索”的独立 release lane。它不重新定义
`regulations/*` promotion eligibility，也不把文档站发布等同于 RAG serving。

## Current Status

- status: `active`
- current phase: `Phase 8 release admission hardening`
- current focus: query-enabled regulation release 已改为 admission-manifest
  fail-closed；此前 Phase 13 的 `institutional_rules` release 在补齐 matching
  admission proof 前按 suspect release 处理

## Why This Workstream Exists

regulation 类内容进入下游 RAG 需要比文档站更长的链路：

`canonical document -> document-units -> chunks -> embedding/index ->
release admission -> acceptance -> serving alias`

当前缺少一条稳定的 `rag_release_candidate` lifecycle。结果是 operator 很难区分：

- document site 已发布
- RAG 准备中
- index release 已生成
- serving alias 已切换
- retrieval verification 已通过或失败

这条 workstream 的目标是把这些状态变成 repo-owned contract，而不是靠一次性 smoke
或手工判断。

## Source Truth

- `docs/architecture/target-architecture.md`
- `docs/architecture/system/data-plane-architecture.md`
- `docs/architecture/system/retrieval-serving-architecture.md`
- `docs/architecture/domains/authenticated-notice/architecture.md`
- `.planning/workstreams/authenticated-notice-regulation-consumption/README.md`
- `.planning/workstreams/notice-derived-regulation-consumption-quality-gate/README.md`

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Phase Plans

- `./phases/phase-00-architecture-and-design-contract/PLAN.md`
- `./phases/phase-00-architecture-and-design-contract/SUMMARY.md`
- `./phases/phase-01-to-05-core-implementation/PLAN.md`
- `./phases/phase-01-to-05-core-implementation/SUMMARY.md`
- `./phases/phase-06-canary-cohort-closeout/PLAN.md`
- `./phases/phase-06-canary-cohort-closeout/SUMMARY.md`
- `./phases/phase-07-phase13-backfill-release-admission/PLAN.md`
- `./phases/phase-07-phase13-backfill-release-admission/SUMMARY.md`
- `./phases/phase-08-release-admission-hardening/PLAN.md`
