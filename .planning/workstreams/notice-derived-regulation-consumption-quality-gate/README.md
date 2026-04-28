---
doc_type: index
status: completed
created: 2026-04-28
updated: 2026-04-28
---
# Workstream: Notice-Derived Regulation Consumption Quality Gate

<!-- markdownlint-disable MD013 -->

这是 `notice-derived-regulation-consumption-quality-gate` 的 native workstream 入口。

这条线只负责 authenticated internal notice 中 regulation-like notice 的消费标准、promotion
eligibility、target materialization gate 与文档站/RAG 消费前质量验收。

它不重开已完成的 `authenticated-notice-regulation-consumption` 旧线，不复写
`notice-consumption-layer` 的通用 projection owner，也不把“修订/发布通知”自动升级成
`regulations/institutional_rules` 完整制度正文。

## Current Status

- status: `completed`
- current phase: `Phase 6 completed`
- current focus: selected cohort、negative fixture、runbook、regression command 与 reopen
  rule 已冻结；后续只按 bounded reopen rule 恢复
- runtime claim: 使用 `uv run --all-packages python -m scripts.workstream_claim
  claim status notice-derived-regulation-consumption-quality-gate` 查看；tracked planning
  文档不保存 claim lease

## Why This Workstream Exists

`187233` 暴露出一个边界问题：

- notice title 命中 `关于修订《...管理办法》的通知`
- source-truth 没有附件、没有链接、没有完整办法正文
- 清壳后正文只剩 `主要修订内容` / `采购注意事项`
- 旧链路仍把它提升为 `regulations/institutional_rules` 文档

这违反 ADR-0035：

> `regulations/*` collection 的成员固定只能是可独立消费的正式制度正文或稳定规范性手册正文。

本 workstream 的目标是把这个判断从单点修复升级为 repo-owned consumption contract。

## Source Truth And Adjacent Workstreams

- regulation promotion boundary:
  `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- source channel:
  `docs/architecture/domains/authenticated-notice/architecture.md`
- source truth schema:
  `docs/data/authenticated-notice-source-truth-schema.md`
- current completed regulation line:
  `.planning/workstreams/authenticated-notice-regulation-consumption/README.md`
- generic notice consumption foundation:
  `.planning/workstreams/notice-consumption-layer/README.md`
- notice routing / Web card line:
  `.planning/workstreams/notice-routing-taxonomy-and-web-card-consumption/README.md`

## Native Planning Truth

- requirements: `./REQUIREMENTS.md`
- roadmap: `./ROADMAP.md`
- state: `./STATE.md`

## Phase Plans

- `./phases/phase-00-admission-and-187233-cleanup/PLAN.md`
- `./phases/phase-01-promotion-eligibility-contract/PLAN.md`
- `./phases/phase-01-promotion-eligibility-contract/SUMMARY.md`
- `./phases/phase-02-selected-cohort-audit/PLAN.md`
- `./phases/phase-02-selected-cohort-audit/SUMMARY.md`
- `./phases/phase-03-target-materialization-contract/PLAN.md`
- `./phases/phase-03-target-materialization-contract/SUMMARY.md`
- `./phases/phase-04-docs-and-rag-consumption-contract/PLAN.md`
- `./phases/phase-04-docs-and-rag-consumption-contract/SUMMARY.md`
- `./phases/phase-05-full-text-recovery-lane/PLAN.md`
- `./phases/phase-05-full-text-recovery-lane/SUMMARY.md`
- `./phases/phase-06-acceptance-freeze-and-closeout/PLAN.md`
- `./phases/phase-06-acceptance-freeze-and-closeout/SUMMARY.md`
