---
doc_type: policy
status: active
created: 2026-03-28
updated: 2026-03-29
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
  - `overall.runtime_status`
  - `overall.transient_runtime_failure_count`
  - `overall.hard_unavailable_failure_count`
  - `overall.non_retryable_runtime_failure_count`
  - `overall.failure_disposition_counts`
  - `overall.preflight_failure_count`
  - `overall.skip_reason`

gate 解释规则：

- 缺 metric aggregate：`missing_metric_aggregate`
- 低于均值阈值：`mean_average_score_below_threshold`
- 低于单 run 下界：`min_run_average_score_below_threshold`
- 波动过大：`run_average_drift_above_threshold`
- 总 run 数不足：`insufficient_total_runs`
- 适用 run 不足：`insufficient_applicable_runs`
- 运行面不可用：`runtime_unavailable`

补充说明：

- 当某个 metric `applicable_runs=0` 且 `overall.runtime_status=unavailable` 时，gate 应报告 `runtime_unavailable`
- 此时不再追加 `mean_average_score_below_threshold`、`min_run_average_score_below_threshold`、`run_average_drift_above_threshold`
- 也就是说，“没有拿到任何分数”与“拿到了分数但低于阈值”必须被区分开

## Failure Mapping

 supplemental runtime 当前采用“deterministic 继续、supplemental 显式分流”的聚合策略：

- judge / ragas runtime 的 case-level 异常不会中断整轮 benchmark，但必须保留 `judge_error`、`failure_reasons`、`failure_disposition`
- preflight 阶段若命中 `transient_retryable` 或 `hard_unavailable`，formal benchmark 会跳过对应 supplemental adapter，不再把整轮 case 都记成伪 failed
- preflight 阶段若命中 `non_retryable_request`，benchmark 会在写出 `supplemental-preflight.json` 后直接中止
- summary / gate report 必须把纯运行面 outage 明确标成 `runtime_unavailable`，不能伪装成阈值低分

这样做的原因：

- deterministic gate 与 supplemental gate 的职责不同
- formal benchmark 需要留下完整证据，而不是因为单次 provider 波动直接丢整轮结果

## Runtime Notes

当前 judge/ragas runtime 的 HTTP tuning 由 repo-tracked live benchmark profile config 持有，不再把这些 knobs 暴露成 root `.env`：

- connect/read/write/pool timeout
- retry attempts / backoff
- circuit breaker failure threshold / cooldown
- preflight timeout
- requests per minute / min interval
- keep-alive expiry
- max connections / max keepalive connections
- `RAGAS_REASONING_EFFORT`
- `RAGAS_TEXT_VERBOSITY`
- `RAGAS_MAX_OUTPUT_TOKENS`

其中 request pacing 的语义：

- pacing 的共享粒度是 `provider origin + api key`
- 可直接指定最小间隔，也可只给 `rpm`，由 runtime 自动派生 `60 / rpm`
- `ragas` judge 与 rubric judge 会复用同一 pacing / keep-alive transport
- 默认值为 `0`，表示不主动节流

使用场景：

- provider 存在严格 request-count window 限流
- formal benchmark 需要在不更换 metric set 的前提下稳定跑完
- provider 握手延迟偏高，需要依赖 keep-alive 避免每次 fresh connect

## Artifact Contract

formal benchmark 产物至少包含：

- `benchmark-config.json`
- `supplemental-preflight.json`
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

repair rerun artifact 额外包含：

- `repair-config.json`
- `repair-plan.json`
- `run-XX-repair-results.json`

repair contract：

- repair rerun 只允许针对 transient infra failure：
  - `429`
  - `5xx`
  - timeout
  - transport error
  - provider runtime marker，例如 `do_request_failed`
- `auth_unavailable`、invalid request、模型名错误等非 transient failure 不属于 repair 边界
- 低分、真实 `warn`、真实 `failed` case 不属于 repair 边界
- repair 结果必须写到新目录
- 原 formal benchmark artifact 不允许被静默覆盖
- repaired `summary.json` / `gate-report.json` 必须带 `provenance.mode=repair_rerun`
- 如果 repair preflight 判定 provider unavailable，则对应 target 必须落为 `skipped_provider_unavailable`，而不是继续重放 case
- 如果 repair rerun 已执行，但 replacement 仍是 unresolved runtime failure（`verdict=failed` 且 `score=null`），则该 target 不得记为 `repaired`
- 此类 target 必须显式写成 `rerun_failed`；若同一 target 只恢复部分 metric，则必须写成 `partially_repaired`

## 2026-03-28 Snapshot

当前 formal benchmark artifact：

- [`.tmp/evals/student-handbook-formal-benchmark-20260328T173355/summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-20260328T173355/summary.json)
- [`.tmp/evals/student-handbook-formal-benchmark-20260328T173355/gate-report.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-20260328T173355/gate-report.json)

当前正式 gate 结论：

- `overall_verdict = warn`
- `pass`:
  - `ragas.faithfulness`
  - `judge.answer_correctness_rubric`
- `warn`:
  - `ragas.answer_relevancy`
  - `ragas.context_precision`
  - `ragas.context_recall`
  - `judge.refusal_quality`

阈值处理原则：

- 本轮不为追求 `pass` 下调阈值
- 现有 fixture 阈值继续保留为 phase-1 目标线
- 当前 `warn` 代表真实 gap，应交回 retrieval / answer / refusal 质量修复，而不是通过 policy 放宽掩盖
- 当前仍有一处 residual runtime noise：
  - `run-02 / release-gate-dormitory-lighting` 的 `ragas.*` 因 provider `429` 未产出分数

## 2026-03-29 Fast-Fail Evidence

最新 formal benchmark 产物：

- [`.tmp/evals/student-handbook-formal-benchmark-20260329T020642/summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-20260329T020642/summary.json)
- [`.tmp/evals/student-handbook-formal-benchmark-20260329T020642/gate-report.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-20260329T020642/gate-report.json)
- [`.tmp/evals/student-handbook-formal-benchmark-20260329T020642/supplemental-preflight.json`](/home/reptilian/code/campus-agent/.tmp/evals/student-handbook-formal-benchmark-20260329T020642/supplemental-preflight.json)

本轮观察到：

- supplemental preflight 直接命中 provider `502 Bad gateway`
- 3 个 adapter 全部被写成 `failure_disposition=transient_retryable` + `run_action=skip_adapter`
- `summary.json` 对 6 个 metric 合成 `overall.runtime_status=unavailable`
- `gate-report.json` 对应 reason 只有 `insufficient_applicable_runs` 与 `runtime_unavailable`

这说明当前 fast-fail 语义已经落地：

- provider 不可用时不会再把每个 case 都灌成伪 failed supplemental result
- gate 不会再把 provider outage 解释成阈值低分
- repair rerun 也不会把这类 preflight unavailable 误当成可重放 case
  - 因此当前 ragas aggregate 为 `11/12` scored completed-case observations
- 该噪声当前已可通过 repo 内的 repair rerun 能力单独重跑并重算 aggregate / gate，但原正式 artifact 仍保留为首次 benchmark 证据

## Relation To Other Docs

- deterministic retrieval / workflow / error gate 指标见 [`student-handbook-eval-metrics.md`](/home/reptilian/code/campus-agent/docs/reference/student-handbook-eval-metrics.md)
- live rebuild 与 handbook serving collection 验收见 [`student-handbook-hybrid-rebuild-checklist.md`](/home/reptilian/code/campus-agent/docs/runbooks/student-handbook-hybrid-rebuild-checklist.md)
