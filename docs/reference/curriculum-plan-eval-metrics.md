---
doc_type: reference
status: active
created: 2026-03-28
updated: 2026-03-29
---

# Curriculum Plan Eval Metrics

## 目的

本文负责记录 `curriculum/curriculum_plan` 当前 repo-tracked release-gate 基线、自动化覆盖面与 live gate artifact contract。

边界：

- live rebuild 与线上 collection 验收步骤以 `docs/runbooks/curriculum-plan-hybrid-rebuild-checklist.md` 为准
- 本文不伪造尚未 fresh rerun 的 live 指标快照
- 本文只说明当前已存在的自动化 gate，以及 live gate 交付时必须补齐的证据形状

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

设计原因：

- `curriculum_plan` 已进入 query-serving，但当前 `develop` 集成线目前缺的是 fresh live evidence，不是 fixture 本身
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
- 可选 `SUMMARY.md`

建议目录：

- `.tmp/evals/curriculum-plan-live-gate-<timestamp>/`

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

截至 2026-03-28：

- curriculum 的 repo-tracked qrels / hybrid / golden / error-gate baseline 已存在并由测试覆盖
- 当前 `develop` 集成线已补齐 curriculum live gate 的 reference + runbook + merge handoff 文档
- 仍待补的是 fresh live rerun artifact，而不是新的 fixture 设计

因此当前 closeout 语义是：

- automated baseline：已具备
- live artifact contract：已具备
- fresh live evidence：待执行
