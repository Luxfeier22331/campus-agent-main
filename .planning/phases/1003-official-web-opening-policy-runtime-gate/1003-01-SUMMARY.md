# 1003-01 Summary: 新闻面 opening policy 与 runtime-profile criteria 已冻结

## Outcome

`1003-01` 已完成。`official_web/stable_reference`、`official_web/fresh_news`、`official_web/news_archive` 的 repo-level consumer posture 已冻结为 machine-checkable contract：

- `stable_reference` 继续是默认 consumer surface
- `fresh_news` 默认关闭，但已拥有明确 opening criteria
- `news_archive` 默认关闭，且只允许显式历史/operator/eval 场景消费

## Key Changes

- `packages/ingestion-core/src/campus_ingestion_core/corpus_profiles.py`
  - runtime-profile schema 现已接受新闻面 opening contract 字段
- `configs/ingestion/official_web/stable_reference/runtime-profile.json`
- `configs/ingestion/official_web/fresh_news/runtime-profile.json`
- `configs/ingestion/official_web/news_archive/runtime-profile.json`
  - 三个 surface 的 serving posture 与 opening criteria 已结构化落盘
- `docs/architecture/official-web-serving-and-news-retrieval-strategy.md`
- `docs/architecture/official-web-architecture.md`
  - policy truth 与 current architecture 边界已同步
- `configs/ingestion/official_web/*/README.md`
  - collection-level README 已与 runtime profile 对齐

## Verification

```bash
uv run --all-packages python -m unittest \
  tests.ingestion.test_corpus_runtime_profile \
  tests.supervisor.test_supervisor_query_policy \
  tests.evals.test_official_web_live_benchmark
```

Result:

- `Ran 46 tests`
- `OK`

## Remaining Gap

- 这一步冻结的是 repo-level policy 与 criteria
- 它不等于 `fresh_news` / `news_archive` 已开放 query-serving

## Next

- 继续把 routing/evidence/eval gate 与 independent-worktree handoff contract 收口到同一口径
