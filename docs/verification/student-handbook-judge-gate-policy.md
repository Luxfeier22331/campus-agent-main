---
doc_type: plan
status: active
created: 2026-03-28
updated: 2026-03-28
---

# Student Handbook Judge Gate Policy

## 目的

本文负责记录 `student_handbook` formal benchmark 的 supplemental judge / ragas gate 形状、阈值来源和 artifact 解释规则。

本文不负责：

- live retrieval / rebuild 的 schema、points count 与 query 抽样
- deterministic release gate 的 case 设计与通过率快照
- 其他 collection 的 judge gate

## Canonical Policy Source

当前 repo-tracked policy fixture：

- [`packages/evals/fixtures/student_handbook_judge_gate_policy.json`](/home/reptilian/code/campus-agent/packages/evals/fixtures/student_handbook_judge_gate_policy.json)
- [`packages/evals/fixtures/student_handbook_judge_rubrics.json`](/home/reptilian/code/campus-agent/packages/evals/fixtures/student_handbook_judge_rubrics.json)

当前代码读取入口：

- [`packages/evals/src/campus_evals/judge_gate.py`](/home/reptilian/code/campus-agent/packages/evals/src/campus_evals/judge_gate.py)
- [`packages/evals/src/campus_evals/judge_adapters.py`](/home/reptilian/code/campus-agent/packages/evals/src/campus_evals/judge_adapters.py)
- [`packages/evals/src/campus_evals/handbook_benchmark.py`](/home/reptilian/code/campus-agent/packages/evals/src/campus_evals/handbook_benchmark.py)

## Policy Shape

当前 gate policy 的固定字段：

- `required_runs`
- `metrics[]`
  - `adapter_id`
  - `metric_name`
  - `gate_level`
  - `min_mean_score`
  - `min_run_average_score`
  - `max_run_average_drift`
  - 可选 `min_applicable_runs`

当前 `student_handbook` policy 仍全部为 `soft_gate`。

这意味着：

- supplemental judge/ragas 当前承担正式观察和预警职责
- 它们不会覆盖 deterministic gate 的 pass/fail 结果
- formal benchmark 的 `overall_verdict=warn` 表示 supplemental 指标未达阈值，不表示 handbook 主链路 deterministic 回归失败

## Current Metric Set

当前 supplemental metric 集：

- `ragas.faithfulness`
- `ragas.answer_relevancy`
- `ragas.context_precision`
- `ragas.context_recall`
- `judge.answer_correctness_rubric`
- `judge.refusal_quality`

适用范围：

- `ragas.*` 与 `judge.answer_correctness_rubric` 只对 `expected_status=completed` 的 case 计分
- `judge.refusal_quality` 只对 `expected_status=no_answer|needs_clarification` 的 case 计分

不适用 case 必须显式落为 `not_applicable`，而不是隐式丢失。

## Run Aggregation Semantics

`run_handbook_formal_benchmark(...)` 当前按以下语义聚合：

- 逐 run 写出 `run-XX-case-results.json`
- 逐 run 写出 `run-XX-summary.json`
- 跨 run 聚合 supplemental metric：
  - `run_average_scores`
  - `mean_average_score`
  - `min_run_average_score`
  - `max_run_average_score`
  - `run_average_drift`
  - `applicable_runs`

gate 解释规则：

- 缺 metric aggregate：`missing_metric_aggregate`
- 低于均值阈值：`mean_average_score_below_threshold`
- 低于单 run 下界：`min_run_average_score_below_threshold`
- 波动过大：`run_average_drift_above_threshold`
- 适用 run 不足：`applicable_runs_below_threshold`

## Failure Mapping

supplemental runtime 当前采用 fail-open for benchmark aggregation：

- judge / ragas runtime 异常不会中断整轮 benchmark
- 异常会被映射成对应 metric 的 `failed` supplemental result
- 结果必须保留 `judge_error` 或等价 metadata，便于区分“模型低分”和“运行面失败”

这样做的原因：

- deterministic gate 与 supplemental gate 的职责不同
- formal benchmark 需要留下完整证据，而不是因为单次 provider 波动直接丢整轮结果

## Runtime Notes

当前 judge/ragas runtime 已支持独立 pacing 配置：

- `RAGAS_REQUEST_TIMEOUT_SECONDS`
- `RAGAS_REQUEST_MIN_INTERVAL_SECONDS`
- `RAGAS_REASONING_EFFORT`
- `RAGAS_TEXT_VERBOSITY`
- `RAGAS_MAX_OUTPUT_TOKENS`

`RAGAS_REQUEST_MIN_INTERVAL_SECONDS` 的语义：

- 对同一 `base_url + api_key` 的 supplemental HTTP 请求施加最小间隔
- `ragas` judge 与 rubric judge 共享同一 pacing 语义
- 默认值为 `0`，表示不主动节流

使用场景：

- provider 存在严格 request-count window 限流
- formal benchmark 需要在不更换 metric set 的前提下稳定跑完

## Artifact Contract

formal benchmark 产物至少包含：

- `benchmark-config.json`
- `run-XX-case-results.json`
- `run-XX-summary.json`
- `summary.json`
- `gate-report.json`
- `SUMMARY.md`

解释优先级：

1. `run-XX-case-results.json`
   用于看单 case 的 supplemental 成败与运行时错误
2. `summary.json`
   用于看跨 run 聚合结果
3. `gate-report.json`
   用于看 policy 阈值比较后的正式 verdict

## Relation To Other Docs

- deterministic retrieval / workflow / error gate 指标见 [`student-handbook-eval-metrics.md`](/home/reptilian/code/campus-agent/docs/verification/student-handbook-eval-metrics.md)
- live rebuild 与 handbook serving collection 验收见 [`student-handbook-hybrid-rebuild-checklist.md`](/home/reptilian/code/campus-agent/docs/verification/student-handbook-hybrid-rebuild-checklist.md)
