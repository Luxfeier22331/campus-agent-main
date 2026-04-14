---
doc_type: index
status: active
created: 2026-04-12
updated: 2026-04-14
---

# Official Web Domain

## 先看什么

- 架构总边界：`../architecture/official-web-architecture.md`
- 当前 merged truth：`../architecture/current-architecture.md`
- 当前项目执行真相：`../../.planning/PROJECT.md`
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

## 当前阅读顺序

- 当前 merged truth 仍以 `../architecture/current-architecture.md` 为准；不要把 `fresh_news` / `news_archive` 的开放状态直接写成已合入真相
- 当前项目级执行状态与独立 worktree 进度统一看 `../../.planning/PROJECT.md`、`../../.planning/STATE.md`
- 进入本域时，默认先读已冻结的 architecture / policy / contract / active reference，再决定是否需要查看独立 worktree 或后续 plan

## Runbooks

- `../runbooks/official-web-collector-smoke-and-audit.md`
- `../runbooks/official-web-dynamic-shell-discovery.md`
- `../runbooks/official-web-source-truth-projection-replay.md`

## Active Reference / Policy

- `../reference/official-web-fresh-news-surface-handoff.md`
- `../reference/official-web-news-surface-opening-checklist.md`
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
- `../reference/official-web-stable-reference-bootstrap-release-20260404.md`
