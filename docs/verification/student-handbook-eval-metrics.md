---
doc_type: plan
status: active
created: 2026-03-27
updated: 2026-03-27
---

# Student Handbook Eval Metrics

## 目的

本文负责记录 `student_handbook` 当前 handbook 主链路的 retrieval 数值指标快照。

边界：

- live rebuild、collection schema、points count、query 验收证据仍以 `student-handbook-hybrid-rebuild-checklist.md` 为准
- 本文只记录 benchmark / workflow 的指标结果、失败样例和本轮修复结论
- 本文不是 release gate 阈值文档，也不把当前快照上升为长期稳定 KPI

## 运行基线

- corpus：`regulations`
- collection：`student_handbook`
- dense：`Qwen3-Embedding-4B @ 2560`
- sparse：`Qdrant native BM25`
- fusion：`RRF`
- qrels fixture：`packages/evals/fixtures/student_handbook_retrieval_qrels.json`

## Retrieval Aggregate

2026-03-27 live retrieval benchmark 汇总：

- total cases：`13`
- `Hit@1 = 1.0`
- `Hit@3 = 1.0`
- `Recall@5 = 0.9743589743589743`
- `Precision@5 = 0.35384615384615387`
- `MRR@5 = 1.0`
- `forbidden_hit_rate = 0.0`

修复前对比：

- `Hit@1 = 0.9230769230769231`
- `Hit@3 = 0.9230769230769231`
- `Recall@5 = 0.8974358974358974`
- `Precision@5 = 0.27692307692307694`
- `MRR@5 = 0.9230769230769231`
- `forbidden_hit_rate = 0.0`

## Retrieval By Split

2026-03-27 当前 qrels split 汇总：

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

- `regression_locked` 当前已经收敛到全量 top-rank 正确命中，适合继续承担高风险回归监控
- `smoke` 的 `Recall@5` 仍低于 `1.0`，说明 phase-1 handbook qrels 里仍存在多相关文档场景未完全覆盖 top-5
- 当前 `Precision@5` 不代表坏结果；phase-1 qrels 仍以 doc-level truth 为主，且允许多相关制度并存

## Workflow / Status Aggregate

2026-03-27 workflow/status 样本评估：

- sample total：`6`
- `status_accuracy = 1.0`
- status distribution：
  - `completed = 4`
  - `no_answer = 1`
  - `needs_clarification = 1`

当前结论：

- 主链路终态语义已覆盖 `completed`、`no_answer`、`needs_clarification`
- 本轮样本未出现 `error`，因此这不是 `error` 分支覆盖率结论
- 本轮 release-gate 样本的 deterministic 四维检查均通过：`status`、`retrieval`、`answer`、`trace`

## Answer / Safety / Gate Aggregate

2026-03-27 release-gate deterministic 指标汇总：

- `answer_accuracy = 1.0`
  - applicable cases：`4`
- `answer_completeness = 1.0`
  - applicable cases：`4`
- `forbidden_claim_rate = 0.0`
  - applicable cases：`4`
- `citation_completeness = 1.0`
  - applicable cases：`4`
- `source_locator_completeness_rate = 1.0`
  - applicable cases：`4`
- `clarification_accuracy = 1.0`
  - applicable cases：`1`
- `no_answer_accuracy = 1.0`
  - applicable cases：`1`
- `fail_closed_rate = 1.0`
  - applicable cases：`1`
- `forbidden_source_retrieval_rate = 0.0`
  - applicable cases：`2`
- `trace_path_correctness = 1.0`
  - applicable cases：`6`
- `error_path_correctness = n/a`
  - 本轮 live release-gate 未纳入稳定的 `error` 样本，因此未形成正式数值

解释：

- 这批指标来自 `student_handbook_release_gate_cases()` 的 deterministic 汇总，不依赖 judge-model
- answer 与 citation/safety 指标当前只在“适用 case”上计数，不把 `needs_clarification` / `no_answer` 样本错误计入 completeness 或 citation denominator
- `forbidden_source_retrieval_rate` 当前只在显式声明 forbidden source 的 case 上统计，因此 denominator 仍然很小

## 失败样例与修复

本轮唯一明确修复的 retrieval regression：

- case id：`no-hit-nonexistent-visa`
- query：`校内宇宙签证办理处`
- 修复前行为：错误返回 handbook 内无关制度片段
- 根因：`_apply_no_hit_policy()` 将 `校内`、`办理` 这类弱中文 bigram 误判为强 lexical support
- 修复后行为：返回空结果，case 指标恢复为 `Hit@1/3 = 1.0`、`Recall@5 = 1.0`、`Precision@5 = 1.0`、`MRR@5 = 1.0`

实现落点：

- [`packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py`](/home/reptilian/code/campus-agent/packages/retrieval-core/src/campus_retrieval_core/backend_qdrant.py)
- [`tests/retrieval/test_backend_qdrant.py`](/home/reptilian/code/campus-agent/tests/retrieval/test_backend_qdrant.py)

## 验证命令

- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_backend_qdrant`
- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.retrieval.test_backend_qdrant tests.evals.test_retrieval_benchmark tests.evals.test_golden_cases`
- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.specialist.test_rag_specialist tests.supervisor.test_supervisor_core tests.retrieval.test_backend_qdrant tests.evals.test_retrieval_benchmark tests.evals.test_golden_cases`
- live qrels benchmark 通过当前 `.env` 的 handbook retrieval backend 逐条查询 qrels case 后，再喂给 `campus_evals.retrieval_benchmark` scorer 汇总

## Fresh Evidence Paths

本轮 fresh rerun 结果已落盘到：

- [`.tmp/phase7/handbook-retrieval-run.json`](/home/reptilian/code/campus-agent/.tmp/phase7/handbook-retrieval-run.json)
- [`.tmp/phase7/handbook-retrieval-summary.json`](/home/reptilian/code/campus-agent/.tmp/phase7/handbook-retrieval-summary.json)
- [`.tmp/phase7/handbook-workflow-status-summary.json`](/home/reptilian/code/campus-agent/.tmp/phase7/handbook-workflow-status-summary.json)
- [`.tmp/phase7/handbook-answer-gate-summary.json`](/home/reptilian/code/campus-agent/.tmp/phase7/handbook-answer-gate-summary.json)

补充说明：

- `handbook-retrieval-summary.json` 记录了 13 条 live qrels case 的 aggregate、split 与逐 case timing/top-hit
- `handbook-workflow-status-summary.json` 记录了 6 条 release-gate 样本的 `completed=4`、`no_answer=1`、`needs_clarification=1` 与四维 deterministic 通过结果
- `handbook-answer-gate-summary.json` 记录了 answer / citation / fail-close / forbidden-source 等新增 deterministic gate 指标

## 未覆盖项

当前尚未在本文形成正式指标快照的项目：

- faithfulness / groundedness
- judge-based answer correctness / rubric score
- explicit refusal quality rubric
- release gate 最终阈值

这些内容当前尚未纳入本轮 deterministic release-gate；如后续要扩展 groundedness / judge-based gate，应另行补充验证文档与阈值定义。
