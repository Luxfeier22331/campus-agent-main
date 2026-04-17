---
doc_type: reference
status: active
created: 2026-03-27
updated: 2026-04-12
---

# Student Handbook Eval Metrics

## 目的

本文记录 `student_handbook` 的稳定评估基线：

- release gate 如何分层
- 当前 repo-tracked 分母是什么
- 已接受的 retrieval / workflow / error 指标快照是什么
- 后续 rerun 应该围绕哪些信号对比

边界：

- live rebuild、collection schema、points count、query 验收步骤仍以 `docs/runbooks/student-handbook-hybrid-rebuild-checklist.md` 为准
- 本文不承担当前执行状态板
- 本文不把单次 `.tmp` 目录提升为默认 canonical 入口

## 活动基线快照

当前 handbook 的活动基线固定为 `2026-04-02` 这一轮 accepted snapshot：

- `deterministic_verdict = pass`
- `supplemental_verdict = pass`
- `final_overall_verdict = pass`
- `repair_run_dir = null`
- `release_gate` case 总数：`11`
  - `completed = 7`
  - `no_answer = 2`
  - `needs_clarification = 2`
- deterministic surface：
  - `run_pass_counts = [11, 11, 11]`
  - `mean_pass_rate = 1.0`
  - `stable_across_runs = true`
- supplemental runtime：
  - preflight `3/3 passed`
  - `https://www.su8.codes /responses = 114/114 success`
  - `https://ai.gitee.com /embeddings = 19/19 success`
- supplemental soft gate：
  - `ragas.faithfulness.mean_average_score = 0.9511440940012369`
  - `ragas.answer_relevancy.mean_average_score = 0.8719210262441276`
  - `ragas.context_precision.mean_average_score = 1.0`
  - `ragas.context_recall.mean_average_score = 1.0`
  - `judge.answer_correctness_rubric.mean_average_score = 0.9238095238095237`
  - `judge.refusal_quality.mean_average_score = 0.9425`

使用规则：

- 未来 handbook 相关改动，默认与这轮快照比较
- 新一轮 rerun 如要替换基线，应直接更新本文件里的分母、结论和关键数值
- 一次性 `.tmp` artifact 继续只作为运行产物，不再在本文件里逐条挂路径

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

`student_handbook` release gate 固定拆成两条轨道：

- live release gate
  - 验证真实 handbook collection 上的稳定主链路
  - 覆盖 `completed`、`needs_clarification`、`no_answer`
- deterministic error gate
  - 通过受控故障注入验证 `error` 终态、fail-close 和 trace error path

设计约束：

- `error` 不依赖 live 基础设施偶发故障取样
- live gate 的 `error_path_correctness = n/a` 只表示“本轮无适用样本”
- `error` 分支必须有独立分母，不能混入 live gate

## 运行基线

- corpus：`regulations`
- collection：`student_handbook`
- dense：`Qwen3-Embedding-4B @ 2560`
- sparse：`Qdrant native BM25`
- fusion：`RRF`
- qrels fixture：`packages/evals/fixtures/student_handbook_retrieval_qrels.json`

## Retrieval Baseline

`2026-03-27` live retrieval benchmark 汇总：

- total cases：`13`
- `Hit@1 = 1.0`
- `Hit@3 = 1.0`
- `Recall@5 = 0.9743589743589743`
- `Precision@5 = 0.35384615384615387`
- `MRR@5 = 1.0`
- `forbidden_hit_rate = 0.0`

split 汇总：

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

- `regression_locked` 已收敛到全量 top-rank 正确命中
- `smoke` 的 `Recall@5 < 1.0` 说明 handbook qrels 仍允许多相关文档并存
- `Precision@5` 在这里不应被误读为失败信号

## Workflow / Release Gate Baseline

`2026-03-27` workflow/status 样本评估：

- sample total：`6`
- `status_accuracy = 1.0`
- status distribution：
  - `completed = 4`
  - `no_answer = 1`
  - `needs_clarification = 1`

`2026-03-27` release-gate deterministic 汇总：

- `answer_accuracy = 1.0`
- `answer_completeness = 1.0`
- `forbidden_claim_rate = 0.0`
- `citation_completeness = 1.0`
- `source_locator_completeness_rate = 1.0`
- `clarification_accuracy = 1.0`
- `no_answer_accuracy = 1.0`
- `fail_closed_rate = 1.0`
- `forbidden_source_retrieval_rate = 0.0`
- `trace_path_correctness = 1.0`
- `error_path_correctness = n/a`

## Deterministic Error Gate Baseline

`2026-03-27` handbook deterministic error gate 汇总：

- sample total：`3`
- `status_accuracy = 1.0`
- `error_path_correctness = 1.0`
- `trace_path_correctness = 1.0`
- `fail_closed_rate = 1.0`
- `answer_accuracy = n/a`

覆盖的故障类型：

- `retrieval_backend_failure`
- `evidence_shaping_failure`
- `invalid_backend_contract`

## 关键回归与修复

当前已明确记录的一条 retrieval regression：

- case id：`no-hit-nonexistent-visa`
- query：`校内宇宙签证办理处`
- 修复前行为：错误返回 handbook 内无关制度片段
- 根因：`_apply_no_hit_policy()` 将 `校内`、`办理` 等弱中文 bigram 误判为强 lexical support
- 修复后行为：返回空结果，case 指标恢复为 `Hit@1/3 = 1.0`、`Recall@5 = 1.0`、`Precision@5 = 1.0`、`MRR@5 = 1.0`

实现落点：

- [backend_qdrant.py](/home/reptilian/code/campus-agent/packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py)
- [test_backend_qdrant.py](/home/reptilian/code/campus-agent/tests/retrieval/test_backend_qdrant.py)

## 维护规则

- 这份文档保存稳定分母、关键数值和解释边界
- 新一轮 rerun 只在以下情况更新这里：
  - release-gate case set 改变
  - qrels denominator 改变
  - accepted baseline verdict 改变
  - 某条高风险回归被正式修复并需要纳入长期说明
- 一次性 artifact 目录、repair 细节和过渡期诊断不再在本文长期保留

## 验证命令

- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_backend_qdrant`
- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_backend_qdrant tests.evals.test_retrieval_benchmark tests.evals.test_golden_cases`
- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.specialist.test_rag_specialist tests.supervisor.test_supervisor_core tests.retrieval.test_backend_qdrant tests.evals.test_retrieval_benchmark tests.evals.test_golden_cases`
