# 08-03 Summary

## Outcome

- handbook golden/live evals 现在覆盖了 Phase 8 的歧义政策对象场景：
  - alias 可解析到单一制度对象
  - 制度对象缺失时 pre-retrieval `needs_clarification`
  - 制度对象已解析但条款不支持时对象内 `no_answer`
- retrieval benchmark fixture 现在把国奖/综测错吸引问题写成 canonical handbook regression truth。

## Main Changes

- `packages/evals/src/campus_evals/scenarios.py`
  - 新增 handbook policy-object clarification/no-answer/release-gate cases
- `packages/evals/fixtures/student_handbook_hybrid_queries.json`
  - 新增 `policy-alias-national-scholarship-article-nine`
  - 新增 `policy-alias-national-scholarship-author-affiliation`
- `packages/evals/fixtures/student_handbook_retrieval_qrels.json`
  - 新增上述两条 canonical qrels，并把 `综合素质测评办法` 设为 forbidden source
- `packages/evals/fixtures/student_handbook_retrieval_annotation_template.json`
  - 与 qrels case count 对齐
- `packages/evals/src/campus_evals/benchmark.py`
  - 新增 `policy_alias_targeted` hybrid category
- `tests/evals/test_golden_cases.py`
- `tests/evals/test_handbook_live_benchmark.py`
- `tests/evals/test_retrieval_benchmark.py`
  - 全部同步到新的 Phase 8 truth

## Verification

- `UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m pytest tests/evals/test_golden_cases.py tests/evals/test_handbook_live_benchmark.py tests/evals/test_retrieval_benchmark.py -q`
  - pass
