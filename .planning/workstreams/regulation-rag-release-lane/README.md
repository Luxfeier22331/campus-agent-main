---
doc_type: index
status: completed
created: 2026-05-02
updated: 2026-05-03
---
# Workstream: Regulation RAG Release Lane

这是 `regulation-rag-release-lane` 的 native workstream 入口。

这条线负责把 notice-derived / canonical regulation document 从“已进入文档站或
registry”推进到“下游 RAG 可检索”的独立 release lane。它不重新定义
`regulations/*` promotion eligibility，也不把文档站发布等同于 RAG serving。

历史存量 regulation 的 canonical/chunk-only backfill 不属于本 workstream 的执行入口；
该批处理由 `historical-regulation-canonical-chunk-backfill` 承接，且在 chunk 质量统一验收前
不得进入 candidate enqueue、embedding、index release 或 alias publish。

## Current Status

- status: `completed`
- current phase: `Phase 15 institutional release baseline gate completed`
- current focus: 42 条校级 `institutional_rules` 已完成清洗/chunk 质量验收、
  registry-scope preparation、release admission、candidate processing 与
  embedding/index/alias publish；42 个 release candidates 全部为
  `serving_published`，alias `institutional_rules` 指向 1747 points 的 Phase 12
  collection。Phase 13 已修复 3 个 golden retrieval 策略缺口，release-gate live
  retrieval 45 cases 与 golden retrieval 89 cases 均达到 `doc_hit@1=1.0` /
  `doc_recall@5=1.0` / `forbidden_hit_rate=0.0`。Phase 14 已完成 42 条
  institutional answer-quality contract 与 `rag_delegate_institutional_rules`
  supervisor product-path smoke，受限校园成员授权投影已固定。Phase 15 已将
  release retrieval、golden retrieval、answer-quality、no-hit policy 与 product-path
  smoke 固化为 `institutional-rules-release-baseline` repo gate，并完成真实跑通。
- boundary: `scoped_rules` 没有全局打开；年度/届次实施办法仍排除在默认文档站/RAG
  consumption 之外

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
- `.planning/workstreams/historical-regulation-canonical-chunk-backfill/README.md`

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
- `./phases/phase-08-release-admission-hardening/SUMMARY.md`
- `./phases/phase-09-institutional-30-release/PLAN.md`
- `./phases/phase-09-institutional-30-release/SUMMARY.md`
- `./phases/phase-10-institutional-rag-consumption/PLAN.md`
- `./phases/phase-10-institutional-rag-consumption/SUMMARY.md`
- `./phases/phase-11-selected-school-level-regulation-admission/SUMMARY.md`
- `./phases/phase-12-institutional-42-quality-and-release/SUMMARY.md`
- `./phases/phase-13-institutional-golden-retrieval-quality-follow-up/PLAN.md`
- `./phases/phase-13-institutional-golden-retrieval-quality-follow-up/SUMMARY.md`
- `./phases/phase-14-institutional-answer-and-product-path-acceptance/PLAN.md`
- `./phases/phase-14-institutional-answer-and-product-path-acceptance/SUMMARY.md`
- `./phases/phase-15-institutional-release-baseline-gate/SUMMARY.md`
