# campus-evals

Evaluation helpers for campus-agent v2.

`fixtures/` 用于保存 repo-tracked 的 live 验收查询样本、retrieval qrels 和 golden-style 输入集。

当前约束：

- `student_handbook_hybrid_queries.json` 负责 live hybrid rebuild/query 验收样本，不承担 canonical retrieval qrels
- `curriculum_plan_hybrid_queries.json` 负责 `curriculum/curriculum_plan` 的 live hybrid/query 验收样本，不承担 canonical retrieval qrels
- retrieval 数值指标所需的 ground truth 应独立维护为专用 qrels fixture，避免与 live 抽样验收样本混用
- handbook live fixture 必须跟随当前 `regulations/student_handbook` 的真实 collection 边界收口；如果 handbook manifest 不再包含 ACL、`campus_scope`、服务导航页等真相，这些 case 不应继续留在 handbook fixture 中
- curriculum live fixture 必须跟随当前 `curriculum/curriculum_plan` 的真实 manifest 边界收口；重点覆盖标题命中、短事实 section、table retrieval、同专业不同方案区分、needs-clarification 与 no-hit
- `policy_title_exact_match` 与 `fixed_phrase_sparse_win` 类 live 样本必须至少能锚定到当前 handbook manifest 的标题关键词；相关 drift guard 由 `tests/evals/test_retrieval_benchmark.py` 覆盖
- curriculum qrels 当前同样采取 `doc_id-level truth first`，第二学士学位、强基计划、创新班与课程教学计划是首批固定回归样本
- `ragas`、OpenAI graders 或其他 judge/scorer 只能作为 `packages/evals` 之后的 supplemental adapter，不得改写 canonical deterministic gate
- `student_handbook` formal benchmark 的 policy / rubric fixture 分别固定在 `student_handbook_judge_gate_policy.json` 与 `student_handbook_judge_rubrics.json`

验证命令：

- `uv run --all-packages python -m unittest tests.evals.test_golden_cases tests.evals.test_retrieval_benchmark`
- `uv run --all-packages python -m unittest tests.evals.test_golden_cases tests.evals.test_retrieval_benchmark tests.evals.test_supplemental_adapters`
- `curriculum` live benchmark 也复用同一 scorer，只需将 `--qrels` 切换为 `packages/evals/fixtures/curriculum_plan_retrieval_qrels.json`

retrieval benchmark CLI：

- `uv run --all-packages python -m campus_evals.retrieval_benchmark --qrels packages/evals/fixtures/student_handbook_retrieval_qrels.json --results <run-results.json>`
- `uv run --all-packages python -m campus_evals.retrieval_benchmark --qrels packages/evals/fixtures/curriculum_plan_retrieval_qrels.json --results <run-results.json>`
- `run-results.json` 输入形状为 `{"schema_version": 1, "cases": [{"case_id": "...", "retrieved_sources": [{"doc_id": "...", "version_id": "...", "chunk_id": "...", "score": 0.9}]}]}`
- 默认输出 text summary；加 `--format json` 输出 aggregate 指标与 `by_split` 汇总

supplemental adapter seam：

- `run_cases(..., supplemental_adapters=(...,))` 可在 deterministic verdict 之外附加 report-only 评分
- `campus_evals.ragas_adapter.build_ragas_projection()` 负责把仓库自有 `GoldenCase + ExecutionResult` 投影成 `ragas` 友好的 `user_input / response / retrieved_contexts / reference`
- `campus_evals.ragas_adapter.RagasSupplementalAdapter` 只负责 supplemental 评分接线，不影响 `CaseResult.passed`
- `RunReport.by_supplemental` 单独聚合 adapter 指标，和 `by_metric` 的 deterministic gate 分离

ragas runtime：

- `campus_evals.settings.RagasSettings.from_env()` 当前消费 `LLM_BASE_URL`、`LLM_API_KEY`、`RAGAS_LLM_MODEL`、`LLM_REASONING_MODEL`、`LLM_CHAT_MODEL`、`RAGAS_REQUEST_TIMEOUT_SECONDS`、`RAGAS_REASONING_EFFORT`、`RAGAS_TEXT_VERBOSITY`、`RAGAS_MAX_OUTPUT_TOKENS`、`RAGAS_USE_RESPONSES_API`、`EMBEDDING_BASE_URL`、`EMBEDDING_API_KEY`、`EMBEDDING_MODEL`
- ragas judge model 选择优先级固定为 `RAGAS_LLM_MODEL > LLM_REASONING_MODEL > LLM_CHAT_MODEL`
- 默认运行面走 `build_http_ragas_llm()` + `build_http_ragas_embeddings()`，直接对 OpenAI-compatible `/responses` 与 `/embeddings` 发原生 HTTP 请求
- 这样做的直接原因是：当前 provider 对原生 HTTP `Responses API` 可用，但会阻断 OpenAI Python SDK / LangChain transport；因此 LangChain 兼容 helper 只保留在内部测试模块 `campus_evals._langchain_compat`，不再作为默认或公开 runtime surface
- `RAGAS_USE_RESPONSES_API` 仍保留在 settings 中，用于 LangChain compatibility helper 的回归测试；默认值仍为 `true`
- `RAGAS_REQUEST_TIMEOUT_SECONDS` 只控制 ragas judge 路径，不再复用 `EMBEDDING_TIMEOUT_SECONDS`
- `RAGAS_REQUEST_MIN_INTERVAL_SECONDS` 可对同一 provider origin 的 supplemental HTTP 请求施加最小间隔，用于在低配额 provider 上稳定跑完 formal benchmark
- Responses judge payload 支持独立低延迟 profile：`RAGAS_REASONING_EFFORT`、`RAGAS_TEXT_VERBOSITY`、`RAGAS_MAX_OUTPUT_TOKENS`
- `n>1` 的 ragas judge 调用现在会在同一 async transport 上并发发出，不再串行放大单 metric 延迟
- `Qwen3-Embedding-4B` 未显式配置 `EMBEDDING_DIMENSIONS` 时，eval 侧默认补成 `2560`
- pinned `ragas==0.4.3` 当前通过 `ragas.evaluate(...)` + legacy metric objects 执行真实评分；默认 scorer 现在直接接 `BaseRagasLLM` / `BaseRagasEmbeddings` 的原生 HTTP 实现
- `uv run` 不会自动读取 `.env`；本地运行前需先 `set -a && source .env && set +a`

最小 smoke：

- `set -a && source .env && set +a && env UV_CACHE_DIR=/tmp/uv-cache uv run --package campus-evals python - <<'PY'`
- `from campus_evals import RagasProjection, RagasSettings, build_ragas_scorer`
- `settings = RagasSettings.from_env()`
- `scorer = build_ragas_scorer(settings)`
- `print(scorer(RagasProjection(case_id="smoke", user_input="学校图书馆开放时间是什么？", response="图书馆开放时间为 08:00 到 22:00。", retrieved_contexts=("图书馆开放时间为 08:00-22:00。",), reference="图书馆开放时间为 08:00-22:00。")))`
- `PY`

student handbook formal benchmark：

- `campus_evals.handbook_benchmark.run_handbook_formal_benchmark(...)` 负责把 live release-gate case 集重跑多轮，并落盘：
  - `run-XX-case-results.json`
  - `run-XX-summary.json`
  - `summary.json`
  - `gate-report.json`
  - `SUMMARY.md`
- `campus_evals.handbook_benchmark.collect_repairable_handbook_benchmark_targets(...)` 会从既有 artifact 中筛出可修复的 transient infra failure；当前只接受运行面失败，不接受低分 case
- `campus_evals.handbook_benchmark.repair_handbook_formal_benchmark(...)` 会在新目录里生成 repair artifact，不会改写原 formal benchmark 目录：
  - `repair-config.json`
  - `repair-plan.json`
  - `run-XX-repair-results.json`
  - repaired `run-XX-case-results.json`
  - repaired `run-XX-summary.json`
  - repaired `summary.json`
  - repaired `gate-report.json`
  - repaired `SUMMARY.md`
- repair rerun 只用于 transient infra failure：
  - `429`
  - `5xx`
  - timeout
  - transport error
  - provider runtime marker，例如 `do_request_failed`
- repair rerun 的 provenance 固定写入 repaired `summary.json` / `gate-report.json`；原 benchmark artifact 保持不可变
- `gate-report.json` 只解释 supplemental judge/ragas 阈值，不替代 deterministic gate
- 当前 `student_handbook` policy fixture 全部是 `soft_gate`；`warn` 表示 supplemental 指标未达阈值，不表示 handbook 主链路 deterministic 回归失败
