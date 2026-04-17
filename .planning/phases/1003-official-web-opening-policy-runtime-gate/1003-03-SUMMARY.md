# 1003-03 Summary: independent official-web worktree acceptance/handoff contract 已固定

## Outcome

`1003-03` 已完成。当前分支与独立 official-web worktree 的责任边界已经固定：

- 当前分支只维护长期 policy truth、runtime gate 与 handoff contract
- 真正的 opening execution、metadata coverage、duplicate collapse、live-gate artifact 生成，都在独立 official-web worktree 完成

这一步避免 future `fresh_news` / `news_archive` 工作再次把局部 seed import、isolated qrels 或单次本地回答误写成 runtime ready。

## Key Changes

- `docs/reference/official-web-news-surface-opening-checklist.md`
  - 新增 canonical opening checklist，固定 artifact 需求、opening gate、不能算成功的结果与 promote prerequisites
- `docs/reference/official-web-fresh-news-surface-handoff.md`
- `docs/reference/official-web-fresh-news-eval-baseline-20260405.md`
  - handoff 与 baseline 参考文档已回收进新的 opening contract 口径
- `.planning/PROJECT.md`
- `.planning/STATE.md`
  - 当前 branch 与独立 worktree 的边界已写回 planning truth

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

- independent official-web worktree 仍需按 opening checklist 产出真实 acceptance artifact
- 当前分支不会在这些 artifact 缺失时宣称 runtime opening success

## Next

- official-web 主线后续只在独立 worktree 继续推进 opening execution / acceptance
