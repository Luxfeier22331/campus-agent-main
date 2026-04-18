# 1000-01 Summary: Canonical curriculum source identity 与 source-unit evidence contract

## Outcome

`1000-01` 已完成。repo 现在不再把 curriculum follow-up 的 internal physical source 和产品 / eval / operator 需要消费的 canonical curriculum source identity 混成一层 truth。

这一步完成了四件事：

- `EvidenceSource` 新增 canonical/source-unit metadata，支持同时表达 physical hit 与 canonical curriculum source identity
- eval expectation 与 golden case source matcher 现在可以按 `canonical_source_id`、`source_unit_kind`、`source_unit_key` 做 deterministic 校验
- `ragas_adapter` 与 `context_diagnostics` 已区分 physical `supporting_doc_ids` 和 canonical `supporting_canonical_source_ids`
- `app_api_chat_runtime` 已能解析新的 evidence fields，使 live benchmark fixture 能接受 `program_semester_facts` physical source + canonical curriculum source 组合

## Key Changes

- `packages/contracts/src/campus_contracts/models.py`
  - `EvidenceSource` 新增 `canonical_source_id`、`canonical_source_title`、`source_unit_kind`、`source_unit_key`
- `packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`
  - curriculum follow-up physical source 现在会带出 canonical/source-unit metadata
- `packages/evals/src/campus_evals/models.py`
  - `ExpectedSourceRef` 支持 canonical/source-unit 断言
- `packages/evals/src/campus_evals/expectations.py`
  - source matcher 支持 canonical vs physical 双层 truth
- `packages/evals/src/campus_evals/scenarios.py`
  - `program_semester_facts` release-gate case 改为 physical source + canonical source 双断言
- `packages/evals/src/campus_evals/context_diagnostics.py`
  - diagnostics 额外暴露 `supporting_canonical_source_ids`、`supporting_source_unit_kinds`、`supporting_source_unit_keys`
- `packages/evals/src/campus_evals/ragas_adapter.py`
  - curriculum context projection 优先 canonical source id
- `packages/evals/src/campus_evals/app_api_chat_runtime.py`
  - 解析新的 evidence fields，保持 live benchmark runtime 与 contract 一致

## Verification

Automated:

```bash
uv run --all-packages python -m unittest \
  tests.contracts.test_models \
  tests.retrieval.test_backend_qdrant \
  tests.evals.test_golden_cases \
  tests.evals.test_context_diagnostics \
  tests.evals.test_curriculum_live_benchmark
```

Result:

- `Ran 186 tests`
- `OK`

## Remaining Gap

- `1000-01` 只修了 canonical/source-unit evidence contract；structured curriculum answer path、semester facts materialization、raw-vs-support observability 仍分别留给 `1000-02`、`1000-03`、`1000-04`

## Next

- 执行 `1000-02`

