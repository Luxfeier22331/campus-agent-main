---
doc_type: index
truth_scope: repository
owner_boundary: docs/reference/archive/official-web
status: active
created: 2026-04-20
updated: 2026-04-20
---
# Official Web Historical Snapshot Archive

## Archive Status

This archive groups historical `official_web` summaries that are no longer on
the default reading path. They keep traceability only; they do not define
current collection scope, runtime opening, source-truth schema, contract shape
or release readiness.

Current canonical entry points are:

- `docs/domains/official-web.md`
- `docs/architecture/domains/official-web/architecture.md`
- `docs/architecture/domains/official-web/freshness-and-incremental-crawling.md`
- `docs/architecture/domains/official-web/serving-and-news-retrieval-strategy.md`
- `docs/data/official-web-source-truth-schema.md`
- `docs/contracts/app-api-official-web-http.md`
- `docs/contracts/app-api-official-web-run-lifecycle.md`
- `docs/policies/official-web-crawl-policy.md`
- `docs/runbooks/official-web-source-truth-projection-replay.md`
- `docs/reference/official-web-eval.md`

## Archived Snapshot Summary

- `2026-03-28` 首版 host survey 把 `official_web` host admission 从经验判断
  收口到显式 allowlist。
- `2026-04-02` 首轮 bounded host expansion 证明 `law` / `history` 可进入
  baseline batch，但不等于 hot lane admission。
- `2026-04-02` mixed `muc_public_pages` 首次 registry-backed release 跑通
  release plumbing，但也证明内容质量不足以成为长期 baseline。
- `2026-04-03` mixed page inventory 分层明确了 stable-like、
  inventory-only 与 future fresh-news handoff 的早期拆分。
- `2026-04-03` 到 `2026-04-05` mixed current-truth QC 推动
  `official_web` 从 mixed bridge 收口到 split scope。
- `2026-04-04` 首次 `stable_reference` routed replay/import/release 是后续
  active baseline 的 bootstrap 执行快照。

## Historical Throughline

- `official_web` 先通过 host survey 固定公开 host admission，再进入 bounded
  host expansion
- mixed `muc_public_pages` 证明了 release lifecycle 可跑通，但也证明 mixed
  bridge 不适合继续承担默认 active baseline
- 后续 canonical truth 转为 split scope：
  - 稳定说明型页面进入 `stable_reference`
  - 新闻页转入受控 handoff / opening 讨论
- 因此这些 snapshot 现在只需要保留“当时为什么这样拆、为什么这样收口”的
  摘要，不再继续维护逐批执行细节

## Usage Rule

- 需要当前真相时，不要从这些 historical snapshot 反推当前策略
- 需要追溯旧执行细节或已删除 path-stub 正文时，通过 git history 追溯
