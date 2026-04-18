---
phase: 10-official-web-serving-surface-stratification-and-fresh-news-readiness
plan: "01"
status: completed
completed_at: "2026-04-04T13:13:17+08:00"
---

# 10-01 Summary

## Outcome

当前 `official_web/muc_public_pages` 的 runtime truth 已明确冻结：

- collection 继续保持 `offline_preparation`
- serving surface 明确标记为 `mixed`
- `今天/最新/最近` 这类 freshness-sensitive queries 明确标记为 `false`
- 不允许 live-search fallback

同时，collection README 已同步到同一 truth：当前 collection 只是本地 QC / replay / forced-validation 用的 offline mixed surface，不是默认 query-serving surface，也不是 freshness-ready answer surface。

## Verification

- `uv run --all-packages python -m unittest tests.ingestion.test_corpus_runtime_profile`: pass
- `rg -n 'mixed|offline|freshness|latest|today|serving surface' configs/ingestion/official_web/muc_public_pages/README.md`: pass

## Locked Repo Truth

- runtime-profile 现在显式承载 serving-surface / freshness policy，而不是只靠隐含约定
- `official_web/muc_public_pages` 当前 truth 仍然是 offline mixed collection
- 本次工作没有打开 official-web 默认 query-serving，也没有扩采范围
