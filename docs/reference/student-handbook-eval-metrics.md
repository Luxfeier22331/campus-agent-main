---
doc_type: reference
truth_scope: eval
owner_boundary: packages/evals
status: active
created: 2026-03-27
updated: 2026-04-20
---
# Student Handbook Eval Metrics

## 目的

本文记录 `student_rules` 的稳定评估基线：

- release gate 如何分层
- repo-tracked denominator 是什么
- accepted retrieval / workflow / supplemental baseline 是什么
- 后续 rerun 应该围绕哪些信号比较

边界：

- live rebuild、collection schema、points count 与 query 验收步骤仍以
  `docs/runbooks/student-handbook-hybrid-rebuild-checklist.md` 为准
- 本文不承担当前执行状态板
- 本文不长期暴露 `.tmp` artifact 路径

## Baseline Contract

repo-tracked 基线入口固定为：

- retrieval qrels：
  `packages/evals/fixtures/rag/student_rules/retrieval_qrels.json`
- workflow / release gate： `packages/evals/src/campus_evals/scenarios.py`
- supplemental policy：
  `packages/evals/fixtures/rag/student_rules/judge_gate_policy.json`
- release acceptance artifact：由当前 TS/Go runtime owner 产出 sanitized
  `student_rules_release_acceptance.v1.result.json`，再交给 coverage / qrels
  tooling 消费；已不再提供 corpus-specific Python live runner entrypoint

## Accepted Release Baseline Snapshot

当前活动 baseline 固定为 `2026-04-02` 这一轮 accepted snapshot：

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
  - `<https://www.su8.codes> /responses = 114/114 success`
  - `<https://ai.gitee.com> /embeddings = 19/19 success`
- supplemental soft gate：
  - `ragas.faithfulness.mean_average_score = 0.9511440940012369`
  - `ragas.answer_relevancy.mean_average_score = 0.8719210262441276`
  - `ragas.context_precision.mean_average_score = 1.0`
  - `ragas.context_recall.mean_average_score = 1.0`
  - `judge.answer_correctness_rubric.mean_average_score = 0.9238095238095237`
  - `judge.refusal_quality.mean_average_score = 0.9425`

## Gate Topology

`student_rules` gate 固定拆成两条轨道：

- release acceptance gate
  - 验证真实 `student_rules` collection 上的稳定主链路
  - 覆盖 `completed`、`needs_clarification`、`no_answer`
- deterministic error gate
  - 通过受控故障注入验证 `error` 终态、fail-close 和 trace error path

设计约束：

- `error` 不依赖 live 基础设施偶发故障取样
- `error_path_correctness = n/a` 只表示 live gate 无适用样本
- `error` 分支必须有独立分母，不能混入 live gate

## Retrieval Baseline

accepted retrieval benchmark 固定为以下 repo-tracked denominator：

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
- `smoke` 的 `Recall@5 < 1.0` 表示 qrels 允许多相关文档并存
- `Precision@5` 在这里不应被误读为失败信号

## Workflow And Error Baseline

workflow/status 基线固定为：

- sample total：`6`
- `status_accuracy = 1.0`
- status distribution：
  - `completed = 4`
  - `no_answer = 1`
  - `needs_clarification = 1`

release-gate deterministic 汇总固定为：

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

deterministic error gate 固定为：

- sample total：`3`
- `status_accuracy = 1.0`
- `error_path_correctness = 1.0`
- `trace_path_correctness = 1.0`
- `fail_closed_rate = 1.0`
- `answer_accuracy = n/a`

覆盖故障类型：

- `retrieval_backend_failure`
- `evidence_shaping_failure`
- `invalid_backend_contract`

## Key Regression Marker

当前仍保留的一条关键 retrieval regression marker：

- case id：`no-hit-nonexistent-visa`
- query：`校内宇宙签证办理处`
- 修复前行为：错误返回 handbook 内无关制度片段
- 根因：`_apply_no_hit_policy()` 将 `校内`、`办理` 等弱中文 bigram 误判为强 lexical support
- 修复后行为：返回空结果，相关 retrieval 指标恢复

实现落点：

- 旧 Python `packages/retrieval-core` / `tests/retrieval` 实现已从 active workspace
  删除；该 marker 现在只保留为 regression behavior 说明
- 后续等价检查应落在 Go-owned retrieval runtime seam 与 repo-owned qrels /
  release-acceptance evidence 上

## Maintenance Rules

- 这份文档只保存稳定分母、关键数值和解释边界
- 一次性 acceptance/rerun 历史、补救过程和 `.tmp` 目录不再长期挂在本文
- 只有在以下情况才更新这里：
  - release-gate denominator 改变
  - qrels denominator 改变
  - accepted baseline verdict 改变
  - supplemental accepted baseline 改变
