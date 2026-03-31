---
doc_type: reference
status: active
created: 2026-03-27
updated: 2026-03-31
---

# Student Handbook Eval Metrics

## 目的

本文负责记录 `student_handbook` 当前 handbook 主链路的 retrieval 数值指标快照，以及 handbook release gate 的双轨验证口径。

边界：

- live rebuild、collection schema、points count、query 验收证据仍以 `docs/runbooks/student-handbook-hybrid-rebuild-checklist.md` 为准
- 本文只记录 benchmark / workflow 的指标结果、失败样例和本轮修复结论
- 本文不是 release gate 阈值文档，也不把当前快照上升为长期稳定 KPI

## 当前快照（2026-03-31）

当前最新 acceptance artifact：

- [`.tmp/evals/student-handbook-formal-benchmark-accept-20260331T210128/final-summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-accept-20260331T210128/final-summary.json)
- [`.tmp/evals/student-handbook-formal-benchmark-accept-20260331T210128/run/summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-accept-20260331T210128/run/summary.json)
- [`.tmp/evals/student-handbook-formal-benchmark-accept-20260331T210128/run/supplemental-provider-summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-accept-20260331T210128/run/supplemental-provider-summary.json)

当前真相：

- `deterministic_verdict = pass`
- `supplemental_verdict = pass`
- `final_overall_verdict = pass`
- `repair` 正确跳过：
  - `selected_target_count = 0`
  - `applied_target_count = 0`
- case set 已扩为 `8` 条 `release_gate` case：
  - `completed = 6`
  - `no_answer = 1`
  - `needs_clarification = 1`
- deterministic surface 稳定通过：
  - `run_pass_counts = [8, 8, 8]`
  - `mean_pass_rate = 1.0`
  - `stable_across_runs = true`
- supplemental runtime 已完全恢复可用：
  - preflight `3/3 passed`
  - provider summary 显示 `https://www.su8.codes /responses` 成功 `95/95`，`https://ai.gitee.com /embeddings` 成功 `19/19`
- 所有 supplemental soft gate 已转为 `pass`：
  - `ragas.faithfulness`
    - `mean_average_score = 0.9076839826839826`
  - `ragas.answer_relevancy`
    - `mean_average_score = 0.8735049661543189`
    - `run_average_scores = [0.8775421874043997, 0.8682606525061326, 0.8747120585524245]`
  - `ragas.context_precision`
    - `mean_average_score = 1.0`
  - `ragas.context_recall`
    - `mean_average_score = 1.0`
  - `judge.answer_correctness_rubric`
    - `mean_average_score = 0.9227777777777777`
  - `judge.refusal_quality`
    - `mean_average_score = 0.9783333333333334`

## Fresh Rerun Diagnosis（2026-03-31）

本轮 `210128` acceptance 已把 repo-head remediation 从“代码已落地”推进成“live artifact 已验证”：

- `GoldenCase.reference_context_ids` + ID-based context metrics 继续把 `context_precision/context_recall` 稳定维持在 `1.0`
- `supplemental_metric_overrides` 继续把 lookup/title/article 型 case 排除在 `answer_relevancy` denominator 之外
- `handbook_release_gate_cases()` 当前正式 case set 已固定为 `8` 条，其中 procedure 自然问句包含：
  - `release-gate-student-card`
  - `release-gate-student-card-materials`
  - `release-gate-student-card-time`
- `procedure_directness` 已进入 deterministic surface，并在 3 轮 run 中都达到 `3/3 pass`
- `ragas.answer_relevancy` 不再只由单个 `student-card` case 决定，而是由上述 3 个 procedure case 构成当前 denominator：
  - `run_average_scores = [0.8775421874043997, 0.8682606525061326, 0.8747120585524245]`
  - `mean_average_score = 0.8735049661543189`

因此，当前 handbook quality line 的正式解释已经变为：

- serving/runtime/provider 稳定性问题已关闭
- context truth 与 denominator 污染问题已关闭
- procedure renderer + expanded natural-question inventory 已通过正式 acceptance
- 2026-03-31 `160402` 只保留为当天 earlier snapshot，不再代表当前 handbook truth

## Current Baseline / Future Use（2026-03-31）

当前 repo-head / artifact truth 已重新对齐：

- handbook live acceptance rerun 已完成，不再存在“还需要下一次 rerun 才能确认 repo-head remediation”的待办
- 后续 handbook 相关改动应以 `210128` artifact 作为新的回归基线
- 若未来再次出现 supplemental 退化，应优先比较：
  - `procedure_directness`
  - `student-card / materials / time`
  - `answer_relevancy` denominator
- 在没有新的 runtime failure 证据前，不再回到 provider timeout、repair 语义或 serving alias 稳定性排查

## Gate Topology

当前 `student_handbook` release gate 拆成两条轨道：

- live release gate：验证真实 handbook collection 上的稳定主链路，覆盖 `completed`、`needs_clarification`、`no_answer`
- deterministic error gate：通过受控故障注入验证 `error` 终态、fail-close 和 trace error path

设计原因：

- `error` 不应依赖 live 基础设施的偶发故障来覆盖，否则 gate 会变得脆弱且不可重复
- live gate 的 `error_path_correctness = n/a` 表示“本轮无适用样本”，不是“error 已验证通过”
- `error` 分支必须由单独的 deterministic gate 形成正式 denominator 和通过率

## 运行基线

- corpus：`regulations`
- collection：`student_handbook`
- dense：`Qwen3-Embedding-4B @ 2560`
- sparse：`Qdrant native BM25`
- fusion：`RRF`
- qrels fixture：`packages/evals/fixtures/student_handbook_retrieval_qrels.json`

## Retrieval Aggregate

2026-03-27 live retrieval benchmark 汇总：

- 注：以下数值对应 2026-03-27 当时的 qrels 快照；2026-03-31 `210128` acceptance 已完成，但它验证的是 formal benchmark / release-gate surface，不直接替换这里的 retrieval aggregate。

- total cases：`13`
- `Hit@1 = 1.0`
- `Hit@3 = 1.0`
- `Recall@5 = 0.9743589743589743`
- `Precision@5 = 0.35384615384615387`
- `MRR@5 = 1.0`
- `forbidden_hit_rate = 0.0`

修复前对比：

- `Hit@1 = 0.9230769230769231`
- `Hit@3 = 0.9230769230769231`
- `Recall@5 = 0.8974358974358974`
- `Precision@5 = 0.27692307692307694`
- `MRR@5 = 0.9230769230769231`
- `forbidden_hit_rate = 0.0`

## Retrieval By Split

2026-03-27 当前 qrels split 汇总：

- `regression_locked`
  - total cases：`4`
  - `Hit@1 = 1.0`
  - `Hit@3 = 1.0`
  - `Recall@5 = 1.0`
  - `Precision@5 = 0.2`
  - `MRR@5 = 1.0`
  - `forbidden_hit_rate = 0.0`
- `smoke`
  - total cases：`9`
  - `Hit@1 = 1.0`
  - `Hit@3 = 1.0`
  - `Recall@5 = 0.9629629629629629`
  - `Precision@5 = 0.4222222222222223`
  - `MRR@5 = 1.0`
  - `forbidden_hit_rate = 0.0`

解释：

- `regression_locked` 当前已经收敛到全量 top-rank 正确命中，适合继续承担高风险回归监控
- `smoke` 的 `Recall@5` 仍低于 `1.0`，说明 phase-1 handbook qrels 里仍存在多相关文档场景未完全覆盖 top-5
- 当前 `Precision@5` 不代表坏结果；phase-1 qrels 仍以 doc-level truth 为主，且允许多相关制度并存

## Live Workflow / Status Aggregate

2026-03-27 workflow/status 样本评估：

- sample total：`6`
- `status_accuracy = 1.0`
- status distribution：
  - `completed = 4`
  - `no_answer = 1`
  - `needs_clarification = 1`

当前结论：

- 主链路终态语义已覆盖 `completed`、`no_answer`、`needs_clarification`
- 本轮 live 样本按设计不包含 `error`；`error` 分支由独立 deterministic error gate 覆盖
- 本轮 release-gate 样本的 deterministic 四维检查均通过：`status`、`retrieval`、`answer`、`trace`

## Live Release Gate Aggregate

2026-03-27 release-gate deterministic 指标汇总：

- `answer_accuracy = 1.0`
  - applicable cases：`4`
- `answer_completeness = 1.0`
  - applicable cases：`4`
- `forbidden_claim_rate = 0.0`
  - applicable cases：`4`
- `citation_completeness = 1.0`
  - applicable cases：`4`
- `source_locator_completeness_rate = 1.0`
  - applicable cases：`4`
- `clarification_accuracy = 1.0`
  - applicable cases：`1`
- `no_answer_accuracy = 1.0`
  - applicable cases：`1`
- `fail_closed_rate = 1.0`
  - applicable cases：`1`
- `forbidden_source_retrieval_rate = 0.0`
  - applicable cases：`2`
- `trace_path_correctness = 1.0`
  - applicable cases：`6`
- `error_path_correctness = n/a`
  - applicable cases：`0`
  - reason：`no_applicable_cases`

解释：

- 这批指标来自 `handbook_release_gate_cases()` 的 deterministic 汇总，不依赖 judge-model
- answer 与 citation/safety 指标当前只在“适用 case”上计数，不把 `needs_clarification` / `no_answer` 样本错误计入 completeness 或 citation denominator
- `forbidden_source_retrieval_rate` 当前只在显式声明 forbidden source 的 case 上统计，因此 denominator 仍然很小
- 从本轮开始，`SummaryCount.total=0` 的指标会显式携带 `reason=no_applicable_cases`，避免把 `n/a` 误读为“已验证通过”

## Deterministic Error Gate Aggregate

2026-03-27 handbook deterministic error gate 汇总：

- sample total：`3`
- `status_accuracy = 1.0`
  - applicable cases：`3`
- `error_path_correctness = 1.0`
  - applicable cases：`3`
- `trace_path_correctness = 1.0`
  - applicable cases：`3`
- `fail_closed_rate = 1.0`
  - applicable cases：`3`
- `answer_accuracy = n/a`
  - applicable cases：`0`
  - reason：`no_applicable_cases`

覆盖的故障类型：

- `retrieval_backend_failure`
- `evidence_shaping_failure`
- `invalid_backend_contract`

解释：

- 这批指标来自 `handbook_error_gate_cases()`，由受控故障注入执行，不依赖 live Qdrant 或外部网络波动
- error gate 的目标是验证统一的 `status=error`、`error.code`、trace error path 与 fail-close，不是重复 live retrieval benchmark

## 失败样例与修复

本轮唯一明确修复的 retrieval regression：

- case id：`no-hit-nonexistent-visa`
- query：`校内宇宙签证办理处`
- 修复前行为：错误返回 handbook 内无关制度片段
- 根因：`_apply_no_hit_policy()` 将 `校内`、`办理` 这类弱中文 bigram 误判为强 lexical support
- 修复后行为：返回空结果，case 指标恢复为 `Hit@1/3 = 1.0`、`Recall@5 = 1.0`、`Precision@5 = 1.0`、`MRR@5 = 1.0`

实现落点：

- [`packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`](/home/reptilian/code/campus-agent/packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py)
- [`tests/retrieval/test_backend_qdrant.py`](/home/reptilian/code/campus-agent/tests/retrieval/test_backend_qdrant.py)

## 验证命令

- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_backend_qdrant`
- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_backend_qdrant tests.evals.test_retrieval_benchmark tests.evals.test_golden_cases`
- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.specialist.test_rag_specialist tests.supervisor.test_supervisor_core tests.retrieval.test_backend_qdrant tests.evals.test_retrieval_benchmark tests.evals.test_golden_cases`
- live qrels benchmark 通过当前 `.env` 的 handbook retrieval backend 逐条查询 qrels case 后，再喂给 `campus_evals.retrieval_benchmark` scorer 汇总

## Fresh Evidence Paths

本轮 fresh rerun 结果已落盘到：

- [`.tmp/phase7/handbook-retrieval-run.json`](/home/reptilian/code/campus-agent/.tmp/phase7/handbook-retrieval-run.json)
- [`.tmp/phase7/handbook-retrieval-summary.json`](/home/reptilian/code/campus-agent/.tmp/phase7/handbook-retrieval-summary.json)
- [`.tmp/phase7/handbook-workflow-status-summary.json`](/home/reptilian/code/campus-agent/.tmp/phase7/handbook-workflow-status-summary.json)
- [`.tmp/phase7/handbook-answer-gate-summary.json`](/home/reptilian/code/campus-agent/.tmp/phase7/handbook-answer-gate-summary.json)
- [`.tmp/phase7/handbook-error-gate-summary.json`](/home/reptilian/code/campus-agent/.tmp/phase7/handbook-error-gate-summary.json)

补充说明：

- `handbook-retrieval-summary.json` 记录了 13 条 live qrels case 的 aggregate、split 与逐 case timing/top-hit
- `handbook-workflow-status-summary.json` 记录了 6 条 live release-gate 样本的 `completed=4`、`no_answer=1`、`needs_clarification=1` 与四维 deterministic 通过结果
- `handbook-answer-gate-summary.json` 记录了 live release gate 的 answer / citation / fail-close / forbidden-source 等 deterministic 指标
- `handbook-error-gate-summary.json` 记录了 deterministic error gate 的 `error_path_correctness`、`fail_closed` 与 `no_applicable_cases` 语义

## 2026-03-28 Formal Benchmark

2026-03-28 已完成 handbook fixed-case formal benchmark，fresh artifact 落盘到：

- [`.tmp/evals/student-handbook-formal-benchmark-20260328T173355/summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-20260328T173355/summary.json)
- [`.tmp/evals/student-handbook-formal-benchmark-20260328T173355/gate-report.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-20260328T173355/gate-report.json)
- [`.tmp/evals/student-handbook-formal-benchmark-20260328T173355/SUMMARY.md`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-20260328T173355/SUMMARY.md)

当前 formal benchmark / acceptance artifact contract 还包括：

- `run/supplemental-runtime-events.jsonl`
- `run/supplemental-provider-summary.json`
- 若发生 repair rerun：
  - `repair/supplemental-runtime-events.jsonl`
  - `repair/supplemental-provider-summary.json`
- 若走 `accept`：
  - `accept-config.json`
  - `final-summary.json`

case 集：

- total cases：`6`
- `completed = 4`
- `no_answer = 1`
- `needs_clarification = 1`
- reruns：`3`

deterministic 结果：

- `run_pass_counts = [6, 6, 6]`
- `run_pass_rates = [1.0, 1.0, 1.0]`
- `mean_pass_rate = 1.0`
- `stable_across_runs = true`

supplemental 聚合：

- `judge.answer_correctness_rubric`
  - `mean_average_score = 0.96`
  - `min_run_average_score = 0.9425`
  - `run_average_drift = 0.040000000000000036`
  - gate：`pass`
- `judge.refusal_quality`
  - `mean_average_score = 0.54`
  - `min_run_average_score = 0.54`
  - `run_average_drift = 0.0`
  - gate：`warn`
- `ragas.faithfulness`
  - `mean_average_score = 0.9871001250164477`
  - `min_run_average_score = 0.9781090871705553`
  - `run_average_drift = 0.01810303404156588`
  - gate：`pass`
- `ragas.answer_relevancy`
  - `mean_average_score = 0.7692526174711283`
  - `min_run_average_score = 0.7188073118355898`
  - `run_average_drift = 0.1097459500962823`
  - gate：`warn`
- `ragas.context_precision`
  - `mean_average_score = 0.5555555555356482`
  - `min_run_average_score = 0.49999999997916666`
  - `run_average_drift = 0.16666666666527774`
  - gate：`warn`
- `ragas.context_recall`
  - `mean_average_score = 0.7222222222222222`
  - `min_run_average_score = 0.5`
  - `run_average_drift = 0.5`
  - gate：`warn`

当前 formal benchmark 结论：

- deterministic handbook release gate 已达到 `3/3` 稳定通过
- supplemental gate 最终 verdict 为 `warn`
- 当前不调整 `student_handbook_judge_gate_policy.json` 阈值；这些 `warn` 被保留为正式 gap，而不是通过放宽阈值消除
- supplemental 仍残留一处运行面噪声：
  - `run-02 / release-gate-dormitory-lighting` 的 `ragas.*` 因 provider `429` 未产出分数
  - 因此当前 ragas aggregate 是 `11/12` scored completed-case observations，而不是 `12/12`
  - 该残余噪声不会改变本轮 `overall_verdict=warn` 的高层结论
  - repo 现已支持对这类 transient infra failure 做 repair rerun，并在新目录里生成 repaired aggregate / gate；原 formal benchmark artifact 保持不变

## 2026-03-29 Supplemental Fast-Fail 修复

本轮把 handbook formal benchmark 的 supplemental provider 运行面改成了正式 fast-fail 语义，重点不是继续堆 retry，而是把“provider 不可用”和“metric 低分”彻底分开。

当前语义：

- preflight 现在是 run-level gate，而不是只写个探针文件
- preflight 命中 `transient_retryable` 或 `hard_unavailable` 时：
  - deterministic 主链路继续执行
  - 对应 supplemental adapter 整组跳过
  - `summary.json` 为对应 metric 合成：
    - `overall.runtime_status=unavailable`
    - `overall.preflight_failure_count=1`
    - `overall.skip_reason=preflight_unavailable`
- preflight 命中 `non_retryable_request` 时：
  - formal benchmark 直接中止
  - 只保留 `supplemental-preflight.json` 作为证据，不再继续生成误导性的 supplemental 分数
- repair rerun 若再次命中 provider unavailable：
  - target 会落为 `skipped_provider_unavailable`
  - 不再继续重放 case

根因修复点：

- `supplemental_http.py` 新增统一 `failure_disposition` 分类：
  - `transient_retryable`
  - `hard_unavailable`
  - `non_retryable_request`
- runtime breaker 现在会记住最近一次 failure disposition；`circuit_open` 不再丢失上游根因
- judge/ragas adapter 现在会把 `failure_reasons` 与 `failure_disposition` 写回 supplemental metadata，便于 repair 与 artifact 解释复用同一根因分类

本轮真实产物：

- [`.tmp/evals/student-handbook-formal-benchmark-20260329T020642/summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-20260329T020642/summary.json)
- [`.tmp/evals/student-handbook-formal-benchmark-20260329T020642/gate-report.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-20260329T020642/gate-report.json)
- [`.tmp/evals/student-handbook-formal-benchmark-20260329T020642/supplemental-preflight.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-20260329T020642/supplemental-preflight.json)

这次真实 run 的结论：

- deterministic：
  - `run_pass_counts = [4, 4, 4]`
  - 剩余 live 失败仍是：
    - `release-gate-student-card`
    - `release-gate-dormitory-lighting`
- supplemental：
  - preflight 全部命中 provider `502 Bad gateway`
  - 3 个 adapter 全部被标成 `run_action=skip_adapter`
  - 6 个 supplemental metric 全部以 `runtime_status=unavailable` 合成写入 aggregate
  - gate reasons 只保留 `insufficient_applicable_runs + runtime_unavailable`，没有再伪造低分阈值告警

## 本轮新增运行面修复

为了让 formal benchmark 真正跑完，本轮补了两类 runtime 修复：

- retryable provider error 扩展：
  - `do_request_failed` 现已纳入 supplemental retry 边界
  - 相关实现：[`supplemental_http.py`](/home/reptilian/code/campus-agent/packages/evals/src/campus_evals/supplemental_http.py)、[`ragas_adapter.py`](/home/reptilian/code/campus-agent/packages/evals/src/campus_evals/ragas_adapter.py)
- supplemental request pacing：
  - 新增 repo-tracked supplemental runtime pacing config
  - pacing scope 已按 provider origin 收口，`ragas` 与 rubric judge 的 llm / embeddings 请求共享节流
  - 相关实现：[`live_benchmark.py`](/home/reptilian/code/campus-agent/packages/evals/src/campus_evals/live_benchmark.py)、[`settings.py`](/home/reptilian/code/campus-agent/packages/evals/src/campus_evals/settings.py)、[`supplemental_http.py`](/home/reptilian/code/campus-agent/packages/evals/src/campus_evals/supplemental_http.py)、[`judge_adapters.py`](/home/reptilian/code/campus-agent/packages/evals/src/campus_evals/judge_adapters.py)

本轮 live 运行中仍可见 `wrapped_callable_async ... was never awaited` 类 runtime warning，但它没有阻断 benchmark artifact 写盘；当前它是 supplemental runtime 的残余噪声，不影响本轮 formal benchmark 结论。

2026-03-28 更新：

- `packages/evals` 已新增 `RagasSettings.from_env()`、`build_ragas_dataset()`、`build_ragas_scorer()` 与 env-driven supplemental scorer 接线
- 当前 eval runtime 的长期 env 主入口只保留 provider 连接信息与模型选择：`EVAL_LLM_*`、`EVAL_RAGAS_MODEL`、`EVAL_JUDGE_MODEL`、`EVAL_EMBEDDING_*`；HTTP timeout/retry/pacing/keep-alive 一类 runtime tuning 已移到 repo-tracked live benchmark profile config；judge model 优先级为 `EVAL_JUDGE_MODEL > EVAL_RAGAS_MODEL > RAGAS_LLM_MODEL > LLM_REASONING_MODEL > LLM_CHAT_MODEL`；`Qwen3-Embedding-4B` 在 eval 侧默认补 `dimensions=2560`
- 针对 `ragas==0.4.3`，当前真实评分路径已固定为 `ragas.evaluate(...)` + legacy metric objects；默认运行面不再依赖 `LangChain/OpenAI SDK` transport，而是改成 `packages/evals` 自带的原生 HTTP `Responses` / `Embeddings` client
- 当前 supplemental runtime 已收口为 shared benchmark profile config：
  - connect/read/write/pool timeout
  - 单层 retry
  - `provider origin + api key` 作用域的 shared pacing / circuit breaker
  - preflight timeout
  - request pacing（支持直接填最小间隔，也支持从 `rpm` 自动派生）
  - shared keep-alive transport limits
- 当前 formal benchmark / repair rerun 都共享同一 transient infra failure 分类边界：
  - `429`
  - `5xx`
  - timeout
  - transport error
  - provider runtime marker，例如 `do_request_failed`
- 当前 Responses judge payload 已支持独立低延迟 profile：`RAGAS_REASONING_EFFORT`、`RAGAS_TEXT_VERBOSITY`、`RAGAS_MAX_OUTPUT_TOKENS`
- `AnswerRelevancy` 这类 `n>1` judge 调用已改成在同一 async transport 上并发发出，不再把单 metric 放大成串行多次 `/responses`
- shared transport 现在会复用 HTTP client，并把 keep-alive expiry 提升到适配低 RPM provider 的窗口；preflight 改成 warmup-only，不再因为单次失败直接 poison runtime breaker
- repo 内自动化覆盖当前已补齐：
  - `tests.evals.test_ragas_runtime`
  - `tests.evals.test_supplemental_adapters`
- 先前 live smoke 失败的根因已分两层确认：
  - 第一层：eval runtime 当时仍走 `chat.completions`，而当前 provider 对 `Responses API` 可用、对 `chat.completions` 返回阻断
  - 第二层：即使切到 `Responses API`，当前 provider 仍会阻断 `OpenAI Python SDK / LangChain` 请求栈；同 payload 的原生 HTTP 请求则可正常返回，因此默认 runtime 已收口到原生 HTTP transport
- 2026-03-28 live smoke 证据已更新：
  - `.tmp/ragas-live-smoke.json`：单指标 `faithfulness` 成功，得分 `1.0`
  - `.tmp/ragas-live-smoke-full.json`：完整四指标在 provider 首次返回 `503 system_cpu_overloaded` 后，于第二次尝试成功
  - 当前 test key 下 `Qwen3-Embedding-4B` 没有可用 channel，因此 smoke 使用 provider 当前可用的 `gemini-embedding-001` 仅验证 transport；这不改变仓库对 handbook baseline embedding 的正式配置
- 2026-03-28 handbook readiness 证据已落盘到：
  - [`.tmp/evals/student-handbook-ragas-readiness-20260328T141617/ragas-readiness-summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-ragas-readiness-20260328T141617/ragas-readiness-summary.json)
  - [`.tmp/evals/student-handbook-ragas-readiness-20260328T141617/SUMMARY.md`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-ragas-readiness-20260328T141617/SUMMARY.md)
- 本轮 readiness probe 使用当前 handbook 主链路真实 retrieval 输出，单 case 固定为 `release-gate-scholarship-title`
- 本轮 readiness probe 的 judge 配置为：`RAGAS_LLM_MODEL=gpt-5.4`、显式 `read_timeout=180` runtime override、`RAGAS_REASONING_EFFORT=none`、`RAGAS_TEXT_VERBOSITY=low`、`RAGAS_MAX_OUTPUT_TOKENS=256`
- 本轮 readiness probe 结果：
  - default `.env` 单指标验证：`answer_relevancy = 0.8790205622411746`，耗时 `29.994s`
  - 完整四指标验证：`faithfulness = 0.9761904761904762`（`91.749s`）、`answer_relevancy = 0.8652808340936117`（`47.163s`）、`context_precision = 0.9999999999666667`（`81.713s`）、`context_recall = 1.0`（`11.227s`）
- 本轮与上轮的语义边界不同：
  - 上轮 `.tmp/ragas-live-smoke*.json` 主要用于确认 provider transport 是否可用
  - 本轮 readiness artifact 记录的是当前 `.env` 下 handbook 主链路的真实 judge 数值证据
- repo 级相关验证已通过：
  - `tests.evals.test_ragas_runtime tests.evals.test_supplemental_adapters tests.evals.test_golden_cases tests.evals.test_availability_smoke tests.evals.test_retrieval_benchmark`
  - `53 tests passed`

## 2026-03-30 Acceptance / Repair Follow-up（历史记录）

这一节只保留 2026-03-30 那次 acceptance / repair 的历史 artifact 语义；当前真相以本文开头的“当前快照（2026-03-31）”和下方 `2026-03-31 Acceptance Rerun After Answer-Shaping Fix` 为准。

2026-03-30 handbook acceptance 已重新落盘到：

- [`.tmp/evals/student-handbook-formal-benchmark-accept-20260330T181404/final-summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-accept-20260330T181404/final-summary.json)
- [`.tmp/evals/student-handbook-formal-benchmark-accept-20260330T181404/run/summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-accept-20260330T181404/run/summary.json)
- [`.tmp/evals/student-handbook-formal-benchmark-accept-20260330T181404/repair/summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-accept-20260330T181404/repair/summary.json)
- [`.tmp/evals/student-handbook-formal-benchmark-accept-20260330T181404/repair/repair-summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-accept-20260330T181404/repair/repair-summary.json)

本轮 acceptance 结论：

- `deterministic_verdict = pass`
- `supplemental_verdict = warn`
- `final_overall_verdict = warn`

fresh run / final aggregate 中可稳定确认的 gap：

- `ragas.faithfulness`
  - `applicable_runs = 0`
  - gate reasons：`insufficient_applicable_runs + runtime_unavailable`
- `ragas.answer_relevancy`
  - `mean_average_score = 0.711252770861219`
  - `min_run_average_score = 0.6944160888625259`
- `ragas.context_precision`
  - `mean_average_score = 0.5972222222006944`
  - `min_run_average_score = 0.49999999998333333`
- `judge.refusal_quality`
  - `mean_average_score = 0.7599999999999999`
  - `min_run_average_score = 0.71`

当前对 repair 的解释：

- 这次 acceptance 的 `repair-summary.json` 仍沿用旧语义，把 12 个 `ragas.faithfulness` target 全部写成 `status=repaired`
- 但 repaired aggregate 真正显示的是：
  - `ragas.faithfulness.overall.runtime_status = unavailable`
  - `transient_runtime_failure_count = 12`
  - `runtime_failure_reasons = ["timeout"]`
- 也就是说，这一轮 repair 并没有恢复 `faithfulness`，只是旧 artifact 语义把“已重跑”误记成了“已修复”
- repo 现已修正 repair artifact 逻辑：后续相同场景会记成 `rerun_failed` 或 `partially_repaired`，并把未恢复 metric 保留在 `remaining_metric_keys`

本轮对 runtime 预算的收口：

- 2026-03-28 readiness artifact 已证明 `faithfulness` 在真实 handbook 主链路上可成功完成，单次耗时曾达到 `91.749s`
- 因此 shared live benchmark profile 现在显式把 supplemental `read_timeout` 固定到 `180s`，不再继承偏 chat-style 的低超时预算
- 这一步的目的只是把 runtime budget 对齐到 repo 已落盘证据，不等于自动消除所有 provider 侧 timeout/unavailable

当前结论：

- handbook live serving 已恢复；2026-03-30 acceptance 的 `deterministic_verdict=pass` 说明当前 main-chain 不再是 blocker
- 当前不应先调整 `student_handbook_judge_gate_policy.json` 的 soft gate 阈值
- 应先把 `ragas.faithfulness` 的 runtime budget / provider 行为与真正的质量问题拆开，再看 fresh rerun
- 即使暂时不看 `faithfulness`，`ragas.answer_relevancy`、`ragas.context_precision`、`judge.refusal_quality` 也仍然稳定低于现有阈值；因此当前 `warn` 不能通过放宽阈值来“修复”

## 2026-03-31 Acceptance Rerun After Answer-Shaping Fix

2026-03-31 answer-shaping / `no_answer` boundary 修复后的 fresh acceptance 已落盘到：

- [`.tmp/evals/student-handbook-formal-benchmark-accept-20260331T080614/final-summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-accept-20260331T080614/final-summary.json)
- [`.tmp/evals/student-handbook-formal-benchmark-accept-20260331T080614/run/summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-accept-20260331T080614/run/summary.json)
- [`.tmp/evals/student-handbook-formal-benchmark-accept-20260331T080614/run/run-01-summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-accept-20260331T080614/run/run-01-summary.json)
- [`.tmp/evals/student-handbook-formal-benchmark-accept-20260331T080614/run/run-01-case-results.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-accept-20260331T080614/run/run-01-case-results.json)

本轮 acceptance 结论：

- `deterministic_verdict = pass`
- `supplemental_verdict = warn`
- `final_overall_verdict = warn`
- `repair`
  - `selected_target_count = 0`
  - `applied_target_count = 0`
  - `remaining_transient_failures = 0`

与 2026-03-30 相比，已明确关闭的旧问题：

- `ragas.faithfulness`
  - 从 `runtime_unavailable` 恢复为 `pass`
  - `run_average_scores = [0.9415584415584415, 0.9415584415584415, 0.9415584415584415]`
- `judge.refusal_quality`
  - 从 `warn` 恢复为 `pass`
  - `run_average_scores = [0.965, 0.985, 0.985]`
- repair artifact 不再被错误触发；因为没有 transient failure，所以本轮没有生成 `repair/`

这轮仍保留的真实质量 gap：

- `ragas.answer_relevancy`
  - `run_average_scores = [0.807202064601255, 0.791582213816457, 0.7683160823953851]`
  - `mean_average_score = 0.7890334536043656`
- `ragas.context_precision`
  - `run_average_scores = [0.49999999995, 0.749999999925, 0.749999999925]`
  - `mean_average_score = 0.6666666666`
  - `run_average_drift = 0.249999999975`
- `ragas.context_recall`
  - `run_average_scores = [0.75, 0.75, 1.0]`
  - `mean_average_score = 0.8333333333333334`
  - `run_average_drift = 0.25`

case 级解释：

- `release-gate-dormitory-lighting`
  - 先前的 deterministic wording regression 已关闭；三轮 deterministic 全部通过
  - 但这个 case 仍是当前 supplemental `warn` 的核心来源：
    - `faithfulness = 1.0`
    - `answer_relevancy = 0.6613998730543929`
    - `context_precision = 0.0`
    - `context_recall = [0.0, 0.0, 1.0]`
- `release-gate-student-card`
  - deterministic 已稳定通过
  - `context_precision` 在三轮里出现 `[0.0, 1.0, 1.0]`，是 aggregate drift 的另一个来源

当前结论：

- 2026-03-31 fresh acceptance 已确认当前 handbook follow-up 不再是 provider/runtime 修复问题，而是 answer/support shaping 与 context alignment 的质量问题
- 当前不应通过放宽 `student_handbook_judge_gate_policy.json` 阈值来“关闭”这轮 `warn`
