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
- selected `regression_locked` retrieval qrels 现在已经开始锁到 `doc_id + version_id`；`chunk_id` 仍只在边界长期稳定后使用
- `campus_evals.scenarios` 现在同时提供 handbook / curriculum 的 `smoke`、`regression_locked`、`release_gate` 与 `error_gate` 固定 case 集；`release_gate` 继续服务 live gate，`smoke` / `regression_locked` 负责 repo-tracked 常设回归样本
- handbook / curriculum 的 retrieval annotation template 现在都需要与各自 qrels case inventory 保持一一对应，避免人工标注模板和 canonical qrels 漂移
- deterministic runner 现在接受 `SpecialistResponse` 与 `SupervisorResponse` 两种执行结果；supervisor-only 终态额外覆盖 `approval_required_accuracy` / `rejection_accuracy`
- `ragas`、OpenAI graders 或其他 judge/scorer 只能作为 `packages/evals` 之后的 supplemental adapter，不得改写 canonical deterministic gate
- `student_handbook` formal benchmark 的 policy / rubric fixture 分别固定在 `student_handbook_judge_gate_policy.json` 与 `student_handbook_judge_rubrics.json`

配套文档：

- `docs/reference/student-handbook-eval-metrics.md`
- `docs/reference/curriculum-plan-eval-metrics.md`
- `docs/runbooks/student-handbook-hybrid-rebuild-checklist.md`
- `docs/runbooks/curriculum-plan-hybrid-rebuild-checklist.md`

验证命令：

- `uv run --all-packages python -m unittest tests.evals.test_golden_cases tests.evals.test_retrieval_benchmark`
- `uv run --all-packages python -m unittest tests.evals.test_golden_cases tests.evals.test_retrieval_benchmark tests.evals.test_supplemental_adapters`
- `uv run --all-packages python -m unittest tests.supervisor.test_supervisor_core tests.specialist.test_rag_specialist tests.evals.test_golden_cases tests.evals.test_retrieval_benchmark`
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

live benchmark profile/core：

- `campus_evals.live_benchmark.BenchmarkProfile` 负责冻结 live benchmark 的 case set、executor、supplemental adapters、policy path 与 artifact prefix
- `BenchmarkProfile.http_settings` 是 benchmark runtime tuning 的 repo-tracked ownership，承载 timeout / retry / pacing / keep-alive / connection-pool 默认值
- `campus_evals.live_benchmark.run_live_benchmark_profile(...)` / `repair_live_benchmark_profile(...)` 在 handbook benchmark core 之上提供 profile-based run/repair wrapper
- `campus_evals.handbook_live_benchmark` 与 `campus_evals.curriculum_live_benchmark` 现在都只是 profile entrypoint；新增 corpus 时优先加 profile，不再复制一整套 runner

ragas runtime：

- `campus_evals.settings.RagasSettings.from_env()` 长期主入口只消费 `EVAL_LLM_*`、`EVAL_RAGAS_MODEL`、`EVAL_EMBEDDING_*`
- `campus_evals.settings.JudgeLLMSettings.from_env()` 长期主入口只消费 `EVAL_LLM_*`、`EVAL_JUDGE_MODEL`
- repo 主路径里的 ragas / judge HTTP runtime tuning 不再从 env 读取，而是由 `BenchmarkProfile.http_settings` 显式注入
- low-level helper 仍保留 `SupplementalHTTPSettings.from_env(...)`，仅用于显式本地实验或测试，不再作为长期 benchmark ownership
- ragas model 选择优先级固定为 `EVAL_RAGAS_MODEL > RAGAS_LLM_MODEL > LLM_REASONING_MODEL > LLM_CHAT_MODEL`
- judge model 若未单独配置，则回退到 `EVAL_RAGAS_MODEL > RAGAS_LLM_MODEL > LLM_REASONING_MODEL > LLM_CHAT_MODEL`
- 默认运行面走 `build_http_ragas_llm()` + `build_http_ragas_embeddings()`，直接对 OpenAI-compatible `/responses` 与 `/embeddings` 发原生 HTTP 请求；其中 ragas LLM 固定走 text-first `/responses`，rubric judge 才保留 structured `/responses`，实现边界固定在 `campus_evals.supplemental_http`
- 这样做的直接原因是：当前 provider 对原生 HTTP `Responses API` 可用，但会阻断 OpenAI Python SDK / LangChain transport；因此 LangChain 兼容 helper 只保留在内部测试模块 `campus_evals._langchain_compat`，不再作为默认或公开 runtime surface
- `RAGAS_USE_RESPONSES_API` 仍保留在 settings 中，用于 LangChain compatibility helper 的回归测试；默认值仍为 `true`
- `BenchmarkProfile.http_settings` 现在统一控制 ragas + rubric judge 共享的 supplemental provider runtime，包括 connect/read/write/pool timeout、单层 retry、provider runtime circuit breaker、preflight timeout、request pacing 与 keep-alive
- pacing / breaker 的共享粒度已经收口到 `provider origin + api key`，避免不同 credential 互相污染 rate budget
- 若需要针对某类 benchmark profile 单独调整 pacing，应修改 repo-tracked profile config，而不是再向 root `.env` 添加新键
- internal shared transport 现在会复用 sync/async HTTP client，并把 keep-alive expiry 提升到适配低 RPM provider 的窗口；重复 preflight 会命中同一 runtime signature 的缓存，不再重复消耗 provider 预算
- preflight 现在承担 run-level availability gate：
  - `transient_retryable` / `hard_unavailable` 会把对应 supplemental adapter 标成 `skip_adapter`
  - `non_retryable_request` 会在写出 `supplemental-preflight.json` 后直接中止 benchmark，避免继续生成误导性 0 分 artifact
- ragas preflight 只探测 text `/responses` + `/embeddings` 可用性，不再把 structured `json_schema` 探针失败误判成 ragas runtime 整体不可用
- preflight 失败现在会写出 `failure_disposition` 与 `run_action`，并同步把 runtime breaker / preflight cache 置入 fast-fail 状态
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
  - `supplemental-preflight.json`
  - `run-XX-case-results.json`
  - `run-XX-summary.json`
  - `summary.json`
  - `gate-report.json`
  - `SUMMARY.md`
- `campus_evals.handbook_benchmark.collect_repairable_handbook_benchmark_targets(...)` 会从既有 artifact 中筛出可修复的 supplemental infra failure：
  - 已写入 case 结果的 transient runtime failure
  - `supplemental-preflight.json` 中被 `skip_adapter` 跳过、后续可 backfill 的 unavailable metrics
  - 不接受低分 case 作为 repair target
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
- 当某个 supplemental metric 没有任何可计分 observation，且失败全部来自 retryable runtime / provider outage 时，aggregate 会显式写出 `overall.runtime_status=unavailable`
- 这种场景的 gate reason 会包含 `runtime_unavailable`，而不会再错误地追加 `*_below_threshold` 或 `run_average_drift_above_threshold`
- 当 supplemental preflight 在 run 开始前就判定 provider unavailable 时：
  - formal benchmark 会继续 deterministic 主链路，但不会再执行对应 supplemental adapter
  - `summary.json` 会为被跳过的 metric 合成 `overall.runtime_status=unavailable`、`preflight_failure_count=1`、`skip_reason=preflight_unavailable`
  - repair rerun 会把受影响 target 记为 `skipped_provider_unavailable`，不再盲目重放 case
- repair rerun 如果已经执行但 replacement 仍是 `verdict=failed` 且 `score=null` 的 unresolved runtime failure：
  - target 会记为 `rerun_failed`
  - 只有真正恢复出分数或 `not_applicable` 的 metric 才会进入 `repaired_metric_keys`
  - 同一 target 若只恢复部分 metric，则会记为 `partially_repaired`
- handbook live runner 现已固定为 `campus_evals.handbook_live_benchmark`：
  - `uv run --all-packages python -m campus_evals.handbook_live_benchmark run --reruns 3`
  - `uv run --all-packages python -m campus_evals.handbook_live_benchmark repair --benchmark-dir <formal-benchmark-dir>`
  - `uv run --all-packages python -m campus_evals.handbook_live_benchmark accept --reruns 3 --verbose --log-jsonl .tmp/evals/handbook-runtime-events.jsonl`
  - 该入口直接复用当前 `delegate_to_rag_agent` + `retrieve_sources` 真链路，把 `GoldenCase` 收口为 live `ExecutionResult`
- curriculum live runner 现已固定为 `campus_evals.curriculum_live_benchmark`：
  - `uv run --all-packages python -m campus_evals.curriculum_live_benchmark run --reruns 3`
  - `uv run --all-packages python -m campus_evals.curriculum_live_benchmark repair --benchmark-dir <formal-benchmark-dir>`
  - `uv run --all-packages python -m campus_evals.curriculum_live_benchmark accept --reruns 3 --verbose --log-jsonl .tmp/evals/curriculum-runtime-events.jsonl`
  - 该入口通过 shared `BenchmarkProfile` core 显式绑定 `curriculum_plan_live_gate_policy.json`，不再默认回退到 handbook policy

runtime observability artifact：

- `run` / `repair` 默认都会在 benchmark 目录下写：
  - `supplemental-runtime-events.jsonl`
  - `supplemental-provider-summary.json`
- `accept` 会在 acceptance 根目录额外写：
  - `accept-config.json`
  - `final-summary.json`
- `--log-jsonl` 会把 `accept` 的 runtime log 路径拆成 `<base>.run.jsonl` 与 `<base>.repair.jsonl`
- `--verbose` 现在会直接打印 preflight、retrying、recovered、breaker opened / fast-fail 等高信号事件，便于 live 验收时确认瞬时 provider 错误是否已经被自动重试
