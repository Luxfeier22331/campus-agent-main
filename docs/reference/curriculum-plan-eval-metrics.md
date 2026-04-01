---
doc_type: reference
status: active
created: 2026-03-28
updated: 2026-04-02
---

# Curriculum Plan Eval Metrics

## 目的

本文负责记录 `curriculum/curriculum_plan` 当前 repo-tracked release-gate 基线、自动化覆盖面与 live gate artifact contract。

边界：

- live rebuild 与线上 collection 验收步骤以 `docs/runbooks/curriculum-plan-hybrid-rebuild-checklist.md` 为准
- 本文只记录当前已落盘的 live / acceptance 指标快照，以及 live gate artifact contract
- 本文不把当前 snapshot 上升为长期稳定 KPI

## Gate Topology

当前 `curriculum_plan` gate 分成两层：

- repo-tracked automated baseline
  - retrieval qrels
  - live hybrid query fixture drift guard
  - workflow/status golden cases
  - deterministic error gate cases
- fresh live release gate
  - 在真实 `curriculum_plan` serving collection 上重跑 query / workflow / release-gate 样本
  - 输出 schema、points count、query results、workflow summary 与 deterministic 汇总 artifact

当前长期实现约束：

- `campus_evals.curriculum_live_benchmark` 现在通过 shared `campus_evals.live_benchmark.BenchmarkProfile` core 运行，不再复制 handbook runner 逻辑
- curriculum live gate policy fixture 固定为 `packages/evals/fixtures/curriculum_plan_live_gate_policy.json`
- 该 policy 当前只消费 `ragas.faithfulness`、`ragas.answer_relevancy`、`ragas.context_precision`、`ragas.context_recall`
- curriculum live gate 不再默认回退到 `student_handbook_judge_gate_policy.json`

设计原因：

- `curriculum_plan` 已进入 query-serving，当前 release-gate follow-up 主要是补充指标 `warn` 与 artifact/doc 归一，而不是继续补 fresh rerun
- live gate 和 deterministic gate 要分离；`error` 终态不依赖偶发基础设施故障取样

## Repo-Tracked Automated Baseline

当前已落盘的 curriculum 基线包括：

- retrieval qrels：`packages/evals/fixtures/curriculum_plan_retrieval_qrels.json`
  - total cases：`24`
  - split：
    - `smoke = 16`
    - `regression_locked = 8`
- hybrid live query fixture：`packages/evals/fixtures/curriculum_plan_hybrid_queries.json`
  - total cases：`9`
  - categories：
    - `policy_title_exact_match`
    - `short_fact_section`
    - `table_retrieval`
    - `semantic_dense_win`
    - `needs_clarification`
    - `no_hit`
- workflow/status golden cases：`packages/evals/src/campus_evals/scenarios.py`
  - release gate：`6`
  - smoke：`5`
  - regression_locked：`8`
  - error gate：`3`

当前 automated gate 覆盖的 release-gate 终态：

- `completed = 4`
- `no_answer = 1`
- `needs_clarification = 1`
- deterministic `error = 3`

当前已锁定的高风险 curriculum retrieval 主题：

- 标题 exact-match
- 同专业不同方案区分
- 第二学士学位短事实
- table / 课程地图 retrieval
- 国际学生版本与普通版本区分
- 同专业强基计划与普通培养路径区分
- selected `doc_id + version_id` regression locks
- no-hit fail-close

补充说明：

- `packages/evals` 现在已经能同时评估 `SpecialistResponse` 与 `SupervisorResponse`
- supervisor-only 终态指标 `approval_required_accuracy` / `rejection_accuracy` 已进入 deterministic metric surface，但当前 curriculum repo-tracked case 仍主要覆盖 RAG 主路径

## Live Gate Artifact Contract

每次 curriculum live rerun 至少应产出：

- `curriculum-live-collection-baseline.json`
- `curriculum-retrieval-run.json`
- `curriculum-retrieval-summary.json`
- `curriculum-workflow-status-summary.json`
- `curriculum-answer-gate-summary.json`
- `curriculum-error-gate-summary.json`
- `run/supplemental-runtime-events.jsonl`
- `run/supplemental-provider-summary.json`
- 可选 `SUMMARY.md`

如果使用 `accept`：

- acceptance 根目录还应保留 `accept-config.json` 与 `final-summary.json`
- 若触发 repair rerun，还应保留 `repair/supplemental-runtime-events.jsonl` 与 `repair/supplemental-provider-summary.json`
- 当前实现里 `accept --log-jsonl` 的 runtime logs 会由 `accept-config.json` 指向外部 `<base>.run.jsonl` / `<base>.repair.jsonl`，不再要求它们必须以内嵌文件形式存在于 acceptance root

建议目录：

- `.tmp/evals/curriculum-plan-live-gate-<timestamp>/`

配套 repair 入口：

- `uv run --all-packages python -m campus_evals.curriculum_live_benchmark repair --benchmark-dir <formal-benchmark-dir>`
- repair 只回补 transient supplemental infra failure；当前依赖 ragas adapter 显式暴露四个 metric key，才能从 `supplemental-preflight.json` 回推 backfill target

最低必须记录的证据字段：

- rerun 日期
- git commit / branch
- serving alias 与 physical collection
- collection schema 摘要
- points count
- 通过与失败的 hybrid query case
- retrieval benchmark aggregate / by_split
- workflow/status distribution
- deterministic release gate 与 error gate 汇总

## Verification Commands

repo-tracked自动化基线：

- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.evals.test_retrieval_benchmark tests.evals.test_golden_cases`
- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.supervisor.test_supervisor_core tests.specialist.test_rag_specialist tests.evals.test_retrieval_benchmark tests.evals.test_golden_cases`

retrieval benchmark scorer：

- `uv run --all-packages python -m campus_evals.retrieval_benchmark --qrels packages/evals/fixtures/curriculum_plan_retrieval_qrels.json --results <run-results.json>`

case-level context diagnostics：

- `uv run --all-packages python -m campus_evals.context_diagnostics --case-results <run-XX-case-results.json> --scenario-set curriculum_live_gate --format json`

## Current Status

截至 2026-04-02：

- curriculum 的 repo-tracked qrels / hybrid / golden / error-gate baseline 已存在并由测试覆盖
- 2026-04-02 已完成 curriculum-only canonical 扩样：
  - retrieval qrels 新增 `7` 条 case，覆盖：
    - 中国少数民族语言文学强基计划与普通方案区分
    - 汉语国际教育国际学生版本标题 / 总学分
    - 教育学第二学士学位学制
    - 财政学课程地图 table retrieval
  - workflow fixed cases 新增 `4` 条：
    - `curriculum-smoke-hanyu-international-credits`
    - `curriculum-regression-minority-language-strong-base`
    - `curriculum-regression-education-second-degree-years`
    - `curriculum-regression-fiscal-core-credits`
  - repo-tracked 自动化验证：
    - `tests.evals.test_retrieval_benchmark`
    - `tests.evals.test_golden_cases`
    - `tests.evals.test_context_diagnostics`
    - `tests.evals.test_curriculum_live_benchmark`
    - `tests.evals.test_ragas_runtime`
    共 `120` tests，`OK`
- root worktree 已完成一轮 fresh curriculum live verification；当前可引用 artifact 分两类：
  - contract-shaped live gate evidence：
    - [`.tmp/evals/curriculum-plan-live-gate-20260330T045116/curriculum-live-collection-baseline.json`](/home/reptilian/code/campus-agent/.tmp/evals/curriculum-plan-live-gate-20260330T045116/curriculum-live-collection-baseline.json)
    - [`.tmp/evals/curriculum-plan-live-gate-20260330T045116/curriculum-retrieval-summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/curriculum-plan-live-gate-20260330T045116/curriculum-retrieval-summary.json)
    - [`.tmp/evals/curriculum-plan-live-gate-20260330T045116/curriculum-workflow-status-summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/curriculum-plan-live-gate-20260330T045116/curriculum-workflow-status-summary.json)
    - [`.tmp/evals/curriculum-plan-live-gate-20260330T045116/curriculum-error-gate-summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/curriculum-plan-live-gate-20260330T045116/curriculum-error-gate-summary.json)
  - acceptance verdict evidence：
    - [`.tmp/evals/curriculum-plan-live-gate-accept-20260330T210958/final-summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/curriculum-plan-live-gate-accept-20260330T210958/final-summary.json)
    - [`.tmp/evals/curriculum-plan-live-gate-accept-20260330T210958/run/gate-report.json`](/home/reptilian/code/campus-agent/.tmp/evals/curriculum-plan-live-gate-accept-20260330T210958/run/gate-report.json)
- 2026-03-30 acceptance 当前最终结论：
  - `deterministic_verdict = pass`
  - `supplemental_verdict = warn`
  - `final_overall_verdict = warn`
- 当前 `warn` 不再来自“缺 fresh rerun”，而是来自 supplemental soft-gate：
  - `ragas.context_precision`
    - `mean_average_score = 0.8263888888392361`
    - `min_run_average_score = 0.7916666666104166`
  - `ragas.context_recall`
    - `mean_average_score = 0.75`
    - `min_run_average_score = 0.75`
- 当前 acceptance supplemental runtime 可用：
  - `status_counts.available = 4`
- 2026-04-01 已对上述 `warn` 做 case-level 重放诊断：
  - 新增 `python -m campus_evals.context_diagnostics`，可直接从 `run-XX-case-results.json` 重建 per-case context projection
  - 对 [`.tmp/evals/curriculum-plan-live-gate-accept-20260330T210958/run/run-01-case-results.json`](/home/reptilian/code/campus-agent/.tmp/evals/curriculum-plan-live-gate-accept-20260330T210958/run/run-01-case-results.json) 的重放表明：
    - `curriculum-release-gate-ethnology-title`
    - `curriculum-release-gate-total-credits`
    - `curriculum-release-gate-course-map-table`
    在当前 repo-head 的 `build_ragas_projection()` 下都走 `id_based` route，且 `retrieved_context_ids` 与 `reference_context_ids` 已对齐
  - 因此 2026-03-30 artifact 中的 `context_precision/context_recall warn` 应视为历史 artifact 与当前 repo-head 行为不一致，而不是当前 canonical truth 或当前 projection 逻辑仍然失真
- 2026-04-01 fresh acceptance evidence：
  - [`.tmp/evals/curriculum-plan-live-gate-accept-20260401T210357/final-summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/curriculum-plan-live-gate-accept-20260401T210357/final-summary.json)
  - [`.tmp/evals/curriculum-plan-live-gate-accept-20260401T210357/run/gate-report.json`](/home/reptilian/code/campus-agent/.tmp/evals/curriculum-plan-live-gate-accept-20260401T210357/run/gate-report.json)
  - 当前 supplemental 结论已经收口为：
    - `supplemental_verdict = pass`
    - `ragas.context_precision.mean_average_score = 1.0`
    - `ragas.context_recall.mean_average_score = 1.0`
  - 但该轮 overall 仍为 `fail`，原因已从 supplemental 转移到 deterministic lane：
    - `curriculum-release-gate-course-map-table` 在 3 轮 run 中稳定失败
    - 失败原因是旧 case truth 将 `课程地图` 当作字面 required fact，同时被 `procedure_directness` 误纳入“步骤类问句”分母
  - 当前 repo-head 已同步修复这两个 deterministic truth 问题：
    - `course-map-table` 改为以稳定 table fact `专业核心课程 30 学分` 作为 required fact
    - `课程地图怎么安排` 不再触发 `procedure_directness`
  - 第二轮 2026-04-01 acceptance evidence：
    - [`.tmp/evals/curriculum-plan-live-gate-accept-20260401T212906/final-summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/curriculum-plan-live-gate-accept-20260401T212906/final-summary.json)
    - [`.tmp/evals/curriculum-plan-live-gate-accept-20260401T212906/run/summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/curriculum-plan-live-gate-accept-20260401T212906/run/summary.json)
  - 该轮 supplemental 仍为 `pass`，但 final 仍为 `fail`：
    - `deterministic.run_pass_counts = [8, 9, 9]`
    - 唯一失败题为 `curriculum-release-gate-total-credits`
    - 失败原因为 `missing required fact=学分`
  - 随后对当前 repo-head 继续做 live replay 核查：
    - 单题 direct replay 连续 5 次都返回包含 `总学分 | — | — | 159` 的回答形态
    - 新一轮 acceptance 的 `run-01` / `run-02` 也都让 `curriculum-release-gate-total-credits` 通过
  - 因此 `20260401T212906` 中该题的单轮 fail 应视为历史 artifact，不再代表当前 repo-head 的 canonical deterministic truth 仍然失稳
- 2026-04-01 最终 fresh acceptance evidence：
  - [`.tmp/evals/curriculum-plan-live-gate-accept-20260401T215501/final-summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/curriculum-plan-live-gate-accept-20260401T215501/final-summary.json)
  - [`.tmp/evals/curriculum-plan-live-gate-accept-20260401T215501/run/summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/curriculum-plan-live-gate-accept-20260401T215501/run/summary.json)
  - 最终结论：
    - `deterministic_verdict = pass`
    - `supplemental_verdict = pass`
    - `final_overall_verdict = pass`
  - deterministic 已恢复稳定：
    - `run_pass_counts = [9, 9, 9]`
    - `stable_across_runs = true`
  - supplemental soft-gate 结果：
    - `ragas.faithfulness.mean_average_score = 0.9895833333333334`
    - `ragas.answer_relevancy.mean_average_score = 0.8350430733920359`
    - `ragas.context_precision.mean_average_score = 1.0`
    - `ragas.context_recall.mean_average_score = 1.0`
- 2026-04-02 fresh retrieval qrels rerun evidence：
  - [`.tmp/evals/curriculum-plan-live-gate-20260402T011640/curriculum-retrieval-run.json`](/home/reptilian/code/campus-agent/.tmp/evals/curriculum-plan-live-gate-20260402T011640/curriculum-retrieval-run.json)
  - [`.tmp/evals/curriculum-plan-live-gate-20260402T011640/curriculum-retrieval-summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/curriculum-plan-live-gate-20260402T011640/curriculum-retrieval-summary.json)
  - [`.tmp/evals/curriculum-plan-live-gate-20260402T011640/curriculum-retrieval-case-metrics.json`](/home/reptilian/code/campus-agent/.tmp/evals/curriculum-plan-live-gate-20260402T011640/curriculum-retrieval-case-metrics.json)
  - expanded qrels aggregate：
    - `total_cases = 24`
    - `hit@1 = 0.9583333333333334`
    - `hit@3 = 0.9583333333333334`
    - `recall@5 = 0.9583333333333334`
    - `precision@5 = 0.25833333333333336`
    - `mrr@5 = 0.9583333333333334`
    - `forbidden_hit_rate = 0.08333333333333333`
  - by split：
    - `regression_locked.hit@1 = 1.0`
    - `regression_locked.forbidden_hit_rate = 0.125`
    - `smoke.hit@1 = 0.9375`
    - `smoke.forbidden_hit_rate = 0.0625`
  - 当前新增样本本身都已 `hit@1 = 1.0`
  - 当前 residual retrieval gaps 已从“缺 fresh rerun”收敛为两类真实排序问题：
    - legacy sparse fixed-phrase `fixed-phrase-ethnic-experimental-class` 仍未命中目标文档
    - `minority-language-strong-base-title` 与 `semantic-minority-language-strong-base-paraphrase` 虽已 top1 命中目标强基方案，但 forbidden 普通方案仍进入 top-5，导致 `forbidden_hit = true`
- 2026-04-02 fresh acceptance evidence：
  - [`.tmp/evals/curriculum-plan-live-gate-accept-20260402T012008/final-summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/curriculum-plan-live-gate-accept-20260402T012008/final-summary.json)
  - [`.tmp/evals/curriculum-plan-live-gate-accept-20260402T012008/run/summary.json`](/home/reptilian/code/campus-agent/.tmp/evals/curriculum-plan-live-gate-accept-20260402T012008/run/summary.json)
  - [`.tmp/evals/curriculum-plan-live-gate-accept-20260402T012008/run/gate-report.json`](/home/reptilian/code/campus-agent/.tmp/evals/curriculum-plan-live-gate-accept-20260402T012008/run/gate-report.json)
  - 当前 acceptance 结论继续保持：
    - `deterministic_verdict = pass`
    - `supplemental_verdict = pass`
    - `final_overall_verdict = pass`
  - deterministic 仍稳定：
    - `run_pass_counts = [9, 9, 9]`
    - `stable_across_runs = true`
  - supplemental soft-gate 结果：
    - `ragas.faithfulness.mean_average_score = 0.9699074074074074`
    - `ragas.answer_relevancy.mean_average_score = 0.8589371351517249`
    - `ragas.context_precision.mean_average_score = 1.0`
    - `ragas.context_recall.mean_average_score = 1.0`

因此当前 closeout 语义是：

- automated baseline：已具备
- live artifact contract：已具备
- fresh live evidence：已具备
- `context_precision/context_recall` 的历史 `warn` 已完成归因，不再是当前 follow-up 主问题
- `course-map-table` 的 deterministic truth 修复已在 fresh acceptance 中正式闭环
- 当前 curriculum live gate 的 repo-head canonical 结论在 2026-04-02 rerun 下仍然是：`final_overall_verdict = pass`
- expanded curriculum qrels 的 fresh rerun evidence 也已补齐；当前 follow-up 已从“缺 benchmark 证据”切到少量 retrieval 排序残留问题
