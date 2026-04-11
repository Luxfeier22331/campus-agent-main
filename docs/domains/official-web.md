---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-12
---

# Official Web Domain

## 先看什么

- 架构总边界：`../architecture/official-web-architecture.md`
- 当前 merged truth：`../architecture/current-architecture.md`
- 长期方向：`../architecture/target-architecture.md`

## 长期边界与决策

- `../architecture/official-web-architecture.md`
- `../architecture/official-web-source-truth-contract.md`
- `../architecture/official-web-freshness-and-incremental-crawling.md`
- `../architecture/official-web-serving-and-news-retrieval-strategy.md`
- `../decisions/adr-0018-app-api-official-web-control-plane-ownership.md`

## Contract 与 data

- `../contracts/app-api-official-web-http.md`
- `../contracts/app-api-official-web-run-lifecycle.md`
- `../data/app-api-official-web-schema.md`

## 当前执行说明

- `official_web` runtime opening criteria 仍在独立 worktree 推进
- 当前默认不要把 `fresh_news` / `news_archive` 的开放状态写成 merged truth
- 在当前工作树里，`official_web` 默认先消费已冻结的 architecture / policy / contract / active reference，而不是把 deferred plan 当作默认入口

## Runbooks

- `../runbooks/official-web-collector-smoke-and-audit.md`
- `../runbooks/official-web-dynamic-shell-discovery.md`
- `../runbooks/official-web-source-truth-projection-replay.md`

## Active Reference / Policy

- `../reference/official-web-fresh-news-surface-handoff.md`
- `../reference/official-web-stable-reference-eval-baseline-20260405.md`
- `../reference/official-web-fresh-news-eval-baseline-20260405.md`
- `../policies/official-web-crawl-policy.md`
- `../policies/official-web-cleaning-and-chunking-policy.md`

## Historical Reference / Archive

- `../reference/official-web-muc-public-host-survey.md`
- `../reference/official-web-muc-public-batch-a-law-history-audit-20260402.md`
- `../reference/official-web-muc-public-pages-current-truth-qc-20260403.md`
- `../reference/official-web-muc-public-pages-page-qc-inventory-20260403.md`
- `../reference/official-web-muc-public-pages-release-20260402.md`
