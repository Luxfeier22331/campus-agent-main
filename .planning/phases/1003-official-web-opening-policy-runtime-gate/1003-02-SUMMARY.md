# 1003-02 Summary: 新闻 routing、evidence 与 eval gate 已按 surface 分开

## Outcome

`1003-02` 已完成。repo 现在已经把官方网页面的三类 query intent 明确拆开：

- 稳定说明
- 近期新闻
- 历史新闻

同时，`listing_page` 不再被允许在默认路径上冒充新闻正文主证据，`news_archive` 也不再能静默回填 recent-news ask。

## Key Changes

- `tests/supervisor/test_supervisor_query_policy.py`
  - 固化默认 query boundary：允许 `stable_reference`，拒绝 `fresh_news` / `news_archive`
- `tests/evals/test_official_web_live_benchmark.py`
  - 固化当前 live-gate 仍只接受 repo-level boundary，不把 seed baseline 冒充 runtime opening proof
- `docs/architecture/official-web-serving-and-news-retrieval-strategy.md`
- `docs/architecture/official-web-freshness-and-incremental-crawling.md`
  - freshness gate、detail-first evidence 与 archive default-off posture 已写入长期设计
- `docs/domains/official-web.md`
  - domain 入口文档已同步新的 surface/routing truth

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

- 当前 eval 仍未执行真实 `recent-news ask / stale-local ask / explicit historical ask` opening acceptance
- 这些 artifact 继续留在独立 official-web worktree

## Next

- 为独立 worktree 固定 acceptance / handoff checklist，避免 future opening 再次被 seed 成果冒充
