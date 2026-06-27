---
doc_type: reference
truth_scope: eval
owner_boundary: packages/evals
status: active
created: 2026-03-28
updated: 2026-04-12
---
# Curriculum Plan Eval Metrics

## 目的

本文记录 `curriculum/curriculum_plan` 的稳定评估基线：

- repo-tracked automated denominator 是什么
- live gate artifact contract 是什么
- 哪些 curriculum retrieval / workflow 主题已经被锁进长期回归面
- 当前应如何理解历史 live acceptance 与后续 rerun

边界：

- live rebuild 与线上 collection 验收步骤仍以
  `docs/runbooks/curriculum-plan-hybrid-rebuild-checklist.md` 为准
- 本文不承担当前执行状态板
- 本文不把单次 `.tmp` 目录提升为默认 canonical 入口

## Gate Topology

`curriculum_plan` gate 固定分成两层：

- repo-tracked automated baseline
  - retrieval qrels
  - live hybrid query fixture drift guard
  - workflow/status golden cases
  - deterministic error gate cases
- fresh release acceptance gate
  - 在真实 `curriculum_plan` serving collection 上重跑 query / workflow /
    release-gate 样本
  - 产出 schema、points count、query results、workflow summary 与 deterministic 汇总
    artifact

长期实现约束：

- corpus-specific Python live runner 已删除；fresh release acceptance artifact
  由当前 TS/Go runtime owner 产出，再输入 eval coverage / qrels tooling
- live gate policy fixture 固定为
  `packages/evals/fixtures/rag/curriculum_plan/live_gate_policy.json`
- 该 policy 只消费：
  - `ragas.faithfulness`
  - `ragas.answer_relevancy`
  - `ragas.context_precision`
  - `ragas.context_recall`
- curriculum live gate 不再回退到 handbook judge policy

## Repo-Tracked Automated Baseline

当前已冻结的自动化基线包括：

- retrieval qrels：`packages/evals/fixtures/rag/curriculum_plan/retrieval_qrels.json`
  - total cases：`25`
  - `smoke = 16`
  - `regression_locked = 9`
- hybrid live query
  fixture：`packages/evals/fixtures/rag/curriculum_plan/hybrid_queries.json`
  - total cases：`12`
  - categories： - `policy_title_exact_match` - `fixed_phrase_sparse_win` -
    `short_fact_section` - `table_retrieval` - `semantic_dense_win` -
    `needs_clarification` - `no_hit`
- workflow/status golden cases：`packages/evals/src/campus_evals/scenarios.py`
  - release gate：`14`
  - smoke：`10`
  - regression_locked：`35`
  - error gate：`3`

自动化 gate 覆盖的 release-gate 终态：

- `completed = 12`
- `no_answer = 1`
- `needs_clarification = 1`
- deterministic `error = 3`

## 高风险主题清单

当前已锁定的高风险 curriculum retrieval / answer 主题：

- 标题 exact-match
- 同专业不同方案区分
- 第二学士学位短事实
- table / 课程设置 retrieval
- uniquely grounded sparse fixed-phrase retrieval
- program-family membership / doc-fragment split
- program-family full alias / name-pattern completed answer
- semester-grounded course retrieval
- 国际学生版本与普通版本区分
- 同专业强基计划与普通培养路径区分
- selected `doc_id + version_id` regression locks
- course / course-family schedule answer
- no-hit fail-close
- retrieval-informed ambiguity clarification

仍作为未来扩样方向，但未并入更大 denominator 的主题：

- 长尾 program-family / course alias 扩表
- family-aware completed answer 的 citation/context truth 扩样
- 更多 uniquely grounded sparse fixed-phrase retrieval case

## Active Baseline Interpretation

当前对 curriculum baseline 的 repo-tracked 解释固定为：

- automated baseline 已具备，并由测试覆盖
- live gate artifact contract 已稳定
- `course_facts` 相关 deterministic truth 修复已经落地：
  - `reference_context_ids` 改到 internal `course_facts:*` doc ids
  - resolved `course_facts` query 使用 exact `target_document_ids`
  - family/member/audience/schedule answer 改为直接事实句
  - 原始 `curriculum_plan` 短事实问句优先走 direct fact shaping
- 历史 live acceptance snapshot 仍有参考价值，但不再通过 repo-tracked `.tmp` 链接长期暴露
- 若后续 fresh rerun 遇到 supplemental provider contract regression，应先标记为运行面阻塞，而不是
  curriculum truth gap

补充约束：

- `基地班` 一类 family alias 不允许再通过伪 top1 canonical truth 维持通过
- `强基有哪些专业`、`二学位有哪些专业`、`实验班有哪些` 这类 membership query 可以进入 `program_family_facts`
  completed truth
- `verified identity` 只在 query 自身带 deictic 语义且候选唯一时进入 completed truth
- `profile memory` 只进入 ranking/clarification 语义，不进入 canonical qrels collapse

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

如果使用 `accept`，还应产出：

- `accept-config.json`
- `final-summary.json`
- 若显式启用 operator publish：
  - `operator-observability-publish-summary.json`
- 若触发 repair rerun：
  - `repair/supplemental-runtime-events.jsonl`
  - `repair/supplemental-provider-summary.json`

维护规则：

- 文件名 contract 保留在本文
- 具体某一轮 artifact 路径不再作为默认 repo-tracked 链接长期保存
- 新一轮 rerun 需要更新的是结论、分母和字段 contract，而不是把 `.tmp` 路径堆回本文

## Verification Commands

repo-tracked 自动化基线：

- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest
  tests.evals.test_retrieval_benchmark tests.evals.test_golden_cases`
- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest
  tests.evals.test_retrieval_benchmark tests.evals.test_golden_cases`

retrieval benchmark scorer：

- `uv run --all-packages python -m campus_evals.retrieval_benchmark --qrels
  packages/evals/fixtures/rag/curriculum_plan/retrieval_qrels.json --results
  <run-results.json>`

case-level context diagnostics：

- `uv run --all-packages python -m campus_evals.context_diagnostics
  --case-results <run-XX-case-results.json> --scenario-set curriculum_live_gate
  --format json`

## 维护规则

- 这份文档只保存稳定分母、主题清单、artifact contract 和解释边界
- 一次性 acceptance/rerun 历史、补救过程和 `.tmp` 目录不再长期挂在本文
- 只有在以下情况才更新这里：
  - qrels denominator 改变
  - hybrid fixture denominator 改变
  - release-gate / error-gate 分母改变
  - curriculum baseline 的 accepted interpretation 改变
  - live gate artifact contract 改变
