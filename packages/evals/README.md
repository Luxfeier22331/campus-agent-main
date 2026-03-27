# campus-evals

Evaluation helpers for campus-agent v2.

`fixtures/` 用于保存 repo-tracked 的 live 验收查询样本、retrieval qrels 和 golden-style 输入集。

当前约束：

- `student_handbook_hybrid_queries.json` 负责 live hybrid rebuild/query 验收样本，不承担 canonical retrieval qrels
- retrieval 数值指标所需的 ground truth 应独立维护为专用 qrels fixture，避免与 live 抽样验收样本混用

验证命令：

- `uv run --all-packages python -m unittest tests.evals.test_golden_cases tests.evals.test_retrieval_benchmark`

retrieval benchmark CLI：

- `uv run --all-packages python -m campus_evals.retrieval_benchmark --qrels packages/evals/fixtures/student_handbook_retrieval_qrels.json --results <run-results.json>`
- `run-results.json` 输入形状为 `{"schema_version": 1, "cases": [{"case_id": "...", "retrieved_sources": [{"doc_id": "...", "version_id": "...", "chunk_id": "...", "score": 0.9}]}]}`
- 默认输出 text summary；加 `--format json` 输出 aggregate 指标与 `by_split` 汇总
