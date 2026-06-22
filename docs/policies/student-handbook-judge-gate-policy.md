---
doc_type: policy
truth_scope: ops
owner_boundary: domains/regulations
status: active
created: 2026-03-28
updated: 2026-04-20
---
# Student Handbook Judge Gate Policy

## 目的

本文记录 `student_rules` formal benchmark 的 supplemental judge / ragas gate 形状、阈值来源和
artifact 解释规则。

本文不负责：

- live retrieval / rebuild 的 schema、points count 与 query 抽样
- deterministic release gate 的 case 设计与通过率快照
- 其他 collection 的 judge gate
- 单次 benchmark artifact 的长期保存

## Canonical Policy Source

repo-tracked policy fixture：

- [`packages/evals/fixtures/rag/student_rules/judge_gate_policy.json`](../../packages/evals/fixtures/rag/student_rules/judge_gate_policy.json)
- [`packages/evals/fixtures/rag/student_rules/judge_rubrics.json`](../../packages/evals/fixtures/rag/student_rules/judge_rubrics.json)

代码读取入口：

- [`packages/evals/src/campus_evals/judge_gate.py`](../../packages/evals/src/campus_evals/judge_gate.py)
- [`packages/evals/src/campus_evals/judge_adapters.py`](../../packages/evals/src/campus_evals/judge_adapters.py)
- [`packages/evals/src/campus_evals/formal_benchmark.py`](../../packages/evals/src/campus_evals/formal_benchmark.py)

## Policy Shape

gate policy 的固定字段：

- `required_runs`
- `metrics[]`
  - `adapter_id`
  - `metric_name`
  - `gate_level`
  - `min_mean_score`
  - `min_run_average_score`
  - `max_run_average_drift`
  - 可选 `min_applicable_runs`

当前 `student_rules` policy 仍全部为 `soft_gate`。

这意味着：

- supplemental judge / ragas 承担正式观察和预警职责
- 它们不会覆盖 deterministic gate 的 pass/fail
- `overall_verdict=warn` 表示 supplemental 指标未达阈值，不表示 handbook 主链路 deterministic
  回归失败

## Current Metric Set

当前 supplemental metric 集固定为：

- `ragas.faithfulness`
- `ragas.answer_relevancy`
- `ragas.context_precision`
- `ragas.context_recall`
- `judge.answer_correctness_rubric`
- `judge.refusal_quality`

适用范围：

- `ragas.*` 与 `judge.answer_correctness_rubric` 只对 `expected_status=completed` 的
  case 计分
- `judge.refusal_quality` 只对 `expected_status=no_answer|needs_clarification` 的
  case 计分

不适用 case 必须显式落为 `not_applicable`，而不是隐式丢失。

## Run Aggregation Semantics

`run_formal_benchmark(...)` 按以下语义聚合：

- 逐 run 写出 `run-XX-case-results.json`
- 逐 run 写出 `run-XX-summary.json`
- 跨 run 聚合 supplemental metric：
  - `run_average_scores`
  - `mean_average_score`
  - `min_run_average_score`
  - `max_run_average_score`
  - `run_average_drift`
  - `applicable_runs`
  - `overall.runtime_status`
  - `overall.transient_runtime_failure_count`
  - `overall.hard_unavailable_failure_count`
  - `overall.non_retryable_runtime_failure_count`
  - `overall.failure_disposition_counts`
  - `overall.preflight_failure_count`
  - `overall.skip_reason`

gate reason 固定包括：

- `missing_metric_aggregate`
- `mean_average_score_below_threshold`
- `min_run_average_score_below_threshold`
- `run_average_drift_above_threshold`
- `insufficient_total_runs`
- `insufficient_applicable_runs`
- `runtime_unavailable`

补充规则：

- 当 `applicable_runs=0` 且 `overall.runtime_status=unavailable` 时，gate 必须报告
  `runtime_unavailable`
- “没有拿到任何分数”与“拿到了分数但低于阈值”必须被区分开

## Failure Mapping

supplemental runtime 采用“deterministic 继续、supplemental 显式分流”的聚合策略：

- case-level judge / ragas 异常不会中断整轮 benchmark，但必须保留
  `judge_error`、`failure_reasons`、`failure_disposition`
- preflight 若命中 `transient_retryable` 或 `hard_unavailable`，formal benchmark
  会跳过对应 adapter
- preflight 若命中 `non_retryable_request`，benchmark 会在写出
  `supplemental-preflight.json` 后直接中止
- `summary.json` / `gate-report.json` 必须把纯运行面 outage 标成 `runtime_unavailable`

## Runtime Notes

judge / ragas runtime 的 HTTP tuning 由 repo-tracked live benchmark profile config
持有，不再暴露成 root `.env`：

- connect/read/write/pool timeout
- retry attempts / backoff
- circuit breaker failure threshold / cooldown
- preflight timeout
- requests per minute / min interval
- keep-alive expiry
- max connections / max keepalive connections
- reasoning effort
- text verbosity
- max output tokens

request pacing 语义固定为：

- 粒度是 `provider origin + api key`
- 可直接指定最小间隔，也可只给 `rpm`
- `ragas` judge 与 rubric judge 复用同一 pacing / keep-alive transport
- 默认值为 `0`，表示不主动节流

## Artifact Contract

formal benchmark 产物至少包含：

- `benchmark-config.json`
- `supplemental-preflight.json`
- `run-XX-case-results.json`
- `run-XX-summary.json`
- `summary.json`
- `gate-report.json`
- `SUMMARY.md`

解释优先级固定为：

1. `run-XX-case-results.json`
1. `summary.json`
1. `gate-report.json`

repair rerun 额外包含：

- `repair-config.json`
- `repair-plan.json`
- `run-XX-repair-results.json`

## Repair Contract

repair rerun 只允许针对 transient infra failure：

- `429`
- `5xx`
- timeout
- transport error
- provider runtime marker，例如 `do_request_failed`

以下情况不属于 repair 边界：

- `auth_unavailable`
- invalid request
- 模型名错误
- 真实低分 `warn`
- 真实 `failed`

补充规则：

- repair 结果必须写到新目录
- 原 formal benchmark artifact 不允许被静默覆盖
- repaired `summary.json` / `gate-report.json` 必须带
  `provenance.mode=repair_rerun`
- 若 repair preflight 判定 provider unavailable，对应 target 必须落为
  `skipped_provider_unavailable`
- 若 replacement 仍是 unresolved runtime failure，则该 target 不得记为 `repaired`

## Policy Interpretation

- threshold 变化必须通过 repo-tracked policy fixture 显式修改，不接受“为了过 gate 临时调低阈值”
- provider outage 应解释为 `runtime_unavailable`，而不是低分 truth gap
- formal benchmark 的历史 evidence 应留在一次性 artifact 或单独 historical 文档，不再长期挂在本文

## Relation To Other Docs

- deterministic retrieval / workflow / error gate 指标见
  [`student-handbook-eval-metrics.md`](../reference/student-handbook-eval-metrics.md)
- live rebuild 与 handbook serving collection 验收见
  [`student-handbook-hybrid-rebuild-checklist.md`](../runbooks/student-handbook-hybrid-rebuild-checklist.md)
