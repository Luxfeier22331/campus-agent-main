---
doc_type: reference
status: active
created: 2026-03-28
updated: 2026-03-31
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
  - total cases：`17`
  - split：
    - `smoke = 13`
    - `regression_locked = 4`
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

## Current Status

截至 2026-03-30：

- curriculum 的 repo-tracked qrels / hybrid / golden / error-gate baseline 已存在并由测试覆盖
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

因此当前 closeout 语义是：

- automated baseline：已具备
- live artifact contract：已具备
- fresh live evidence：已具备
- 当前 follow-up：补充指标 `warn` 与 artifact/doc 归一，不再是重新声明“待 fresh rerun”
