---
phase: 10-official-web-serving-surface-stratification-and-fresh-news-readiness
plan: "02"
status: completed
completed_at: "2026-04-04T13:13:17+08:00"
---

# 10-02 Summary

## Outcome

official-web source-truth 和 projection metadata 已补齐 later fresh-news work 需要的时间字段：

- `OfficialWebPageManifest` 新增 canonical `publishedAt`
- collector 只从 detail page 的显式 page-level metadata 提取 `publishedAt`
- listing rows 和泛 body prose 不会被拿来臆造 publication time
- projection report / projection unit metadata 已传播 `published_at`、`fetched_at`、`last_modified`

这意味着后续 fresh-news surface 如果要做时效判断，不需要重新回到原始页面猜时间，而可以直接复用当前 source-truth / replay outputs。

## Verification

- `pnpm --dir apps/official-web-collector exec vitest run test/page-artifacts.test.ts -t "extracts canonical publishedAt"`: pass
- `pnpm --dir apps/official-web-collector test`: pass
- `pnpm --dir apps/official-web-collector typecheck`: pass
- `uv run --all-packages python -m unittest tests.ingestion.test_official_web_projection`: pass

## Locked Repo Truth

- `publishedAt` 现在是 source-truth contract 的一部分
- publication/fetch metadata 已进入 replayed projection outputs
- 当前 repo 仍未把 mixed official-web collection 误判成可直接回答 fresh-news 的 surface
