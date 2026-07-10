---
doc_type: reference
truth_scope: eval
owner_boundary: packages/eval-langfuse
status: active
created: 2026-03-27
updated: 2026-06-27
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
  `docs/runbooks/rag-release.md` 为准
- 本文不承担当前执行状态板
- 本文不长期暴露 `.tmp` artifact 路径

## Baseline Contract

repo-tracked 基线入口固定为：

- retrieval qrels：
  `packages/eval-langfuse/assets/qrels/rag/student_rules/retrieval_qrels.json`
- answer quality cases：
  `packages/eval-langfuse/assets/datasets/rag/student_rules/answer_quality_cases.v1.json`

这些 repo-tracked assets 是公开 source-clean synthetic examples，只验证
schema、dataset manifest、qrels-only projection 和 answer-quality contract
形状。真实 handbook gold truth / release denominator 不在公开仓库 assets 中
发布，应通过私有 asset root 或 Langfuse dataset 进入 eval loop。

历史 workflow / release acceptance fixture 与 judge policy fixture 已从
`packages/eval-langfuse` active package 删除。后续 release-closeout observation 应由 owning
runtime 产出 sanitized observation，再通过 Langfuse datasets / Ragas scoring 或
明确的新 benchmark adapter 消费；不得恢复 corpus-specific Python live runner。

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

accepted retrieval benchmark 的历史数值来自私有/历史 benchmark record，不再由
公开 repo-tracked synthetic fixture denominator 直接代表。

当前公开 synthetic qrels denominator：

- total cases：`6`
- `smoke = 2`
- `curated = 1`
- `regression = 3`

解释：

- public synthetic fixture 不承诺线上 retrieval 指标。
- historical accepted retrieval metrics 需要从对应 private benchmark record
  或 Langfuse run 中解释。

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

- 旧 Python retrieval package / `tests/retrieval` 实现已从 active workspace
  删除；该 marker 现在只保留为 regression behavior 说明
- 后续等价检查应落在 Go-owned retrieval runtime seam 与 repo-owned qrels /
  release acceptance closeout artifact 上

## Maintenance Rules

- 这份文档只保存稳定分母、关键数值和解释边界
- 一次性 acceptance/rerun 历史、补救过程和 `.tmp` 目录不再长期挂在本文
- 只有在以下情况才更新这里：
  - release-gate denominator 改变
  - public synthetic qrels denominator 改变
  - accepted baseline verdict 改变
  - supplemental accepted baseline 改变
