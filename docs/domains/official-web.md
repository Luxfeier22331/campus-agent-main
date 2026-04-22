---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-20
---

# Official Web Domain

## 先看什么

- 架构总边界：`../architecture/domains/official-web/architecture.md`
- 当前 merged truth：`../architecture/current-architecture.md`
- 通用执行态入口：`README.md`
- 长期方向：`../architecture/target-architecture.md`

## 长期边界与决策

- `../architecture/domains/official-web/architecture.md`
- `../data/official-web-source-truth-schema.md`
- `../architecture/domains/official-web/freshness-and-incremental-crawling.md`
- `../architecture/domains/official-web/serving-and-news-retrieval-strategy.md`
- `../decisions/adr-0018-app-api-official-web-control-plane-ownership.md`

## Contract 与 data

- `../contracts/app-api-official-web-http.md`
- `../contracts/app-api-official-web-run-lifecycle.md`
- `../data/app-api-official-web-schema.md`

## 执行路由

- 当前 merged truth 统一看 `../architecture/current-architecture.md`
- 当前项目级执行状态与 workstream registry 统一看 `README.md` 定义的通用执行态入口
- 需要进入 operator/replay 路径时，直接从下面的 runbook
  入口进入；需要恢复 backlog workstream 时，再进入对应
  archive / registry 入口

## Planning / Archive

- 当前 backlog / reopen 规则：`../../.planning/WORKSTREAMS.md`
- 历史 plan snapshot：`../plans/archive/historical/official-web-source-channel-news-opening.md`

## Runbooks

- `../runbooks/official-web-collector-smoke-and-audit.md`
- `../runbooks/official-web-dynamic-shell-discovery.md`
- `../runbooks/official-web-source-truth-projection-replay.md`

## Active Reference / Policy

- `../reference/official-web-fresh-news-surface-handoff.md`
- `../reference/official-web-news-surface-opening-checklist.md`
- `../reference/official-web-stable-reference-eval-baseline.md`
- `../reference/official-web-fresh-news-eval-baseline.md`
- `../policies/official-web-crawl-policy.md`
- `../policies/official-web-cleaning-and-chunking-policy.md`
