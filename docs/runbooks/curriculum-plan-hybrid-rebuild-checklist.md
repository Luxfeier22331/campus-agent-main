---
doc_type: runbook
status: active
created: 2026-03-28
updated: 2026-03-28
---

# Curriculum Plan Hybrid Rebuild Checklist

## 目标

本文负责 `curriculum/curriculum_plan` 当前 query-serving collection 的 live rebuild 与运行验收清单。

当前冻结 baseline：

- dense: `Qwen3-Embedding-4B @ 2560`
- sparse: `Qdrant native BM25`
- sparse tokenizer: `multilingual`
- sparse language: `none`
- fusion: `RRF`
- evidence shape: registry-backed `EvidenceBundle`

## 不在本文负责

- curriculum source-truth 清洗与 split-manifest 规则本身
- supervisor / specialist 的长期编排设计
- handbook 或 `campus_services` 的 live 验收

## 前置真相源

- `docs/architecture/retrieval-query-strategy.md`
- `docs/reference/curriculum-plan-eval-metrics.md`
- `packages/evals/fixtures/curriculum_plan_hybrid_queries.json`
- `packages/evals/fixtures/curriculum_plan_retrieval_qrels.json`
- `.planning/PROJECT.md`
- `.planning/STATE.md`

## Live Rebuild 前检查

- `.env` 中 dense / sparse / fusion 配置与 handbook accepted baseline 一致
- runtime profile 指向 `curriculum/curriculum_plan`
- serving alias、physical collection prefix 与本轮目标 collection 对齐
- `DOCUMENT_REGISTRY_DATABASE_URL` 指向当前 curriculum registry truth
- 如需重建，已明确 alias / collection family 的 reset 策略

## Live Rebuild 执行顺序

1. 校验 `.env`、serving alias 与目标 physical collection。
2. 执行 rebuild 或确认当前 serving collection 已是本轮目标版本。
3. 记录 collection schema、points count 与 payload sample。
4. 用 repo-tracked hybrid fixture 做 live query 抽样。
5. 用 qrels scorer 汇总 retrieval benchmark。
6. 用 release-gate / error-gate case 重跑 workflow/status deterministic gate。
7. 把证据统一落到同一轮 artifact 目录。

## Query 抽样验收

至少覆盖 `curriculum_plan_hybrid_queries.json` 中的以下主题：

- `policy_title_exact_match`
  培养方案标题 exact-match 必须稳定命中目标方案
- `short_fact_section`
  学制、总学分等短事实问题必须回到正确方案
- `table_retrieval`
  课程地图或教学计划表格类问题必须命中目标方案
- `semantic_dense_win`
  强基计划、创新班、第二学士学位等相邻方案不能互相覆盖
- `needs_clarification`
  泛化问题不得静默误答到任意单一方案
- `no_hit`
  虚构专业或虚构规则必须返回空 bundle

## Release-Gate 对齐关系

当前 curriculum gate 建议按三类 evidence 一起交付：

- retrieval benchmark
  使用 `curriculum_plan_retrieval_qrels.json`
- live hybrid query acceptance
  使用 `curriculum_plan_hybrid_queries.json`
- workflow/status deterministic gate
  使用 `curriculum_release_gate_cases()` 与 `curriculum_error_gate_cases()`

## Gate Evidence Template

建议每次 live rerun 至少记录：

- rerun 日期
- git commit / branch
- serving alias
- physical collection 名称
- collection schema 摘要
- points count
- payload sample
- retrieval benchmark aggregate / by_split
- 每个 hybrid case 的 top hit / fail reason
- workflow/status distribution
- deterministic release gate 与 error gate 汇总

建议落盘目录：

- `.tmp/evals/curriculum-plan-live-gate-<timestamp>/`

## 推荐验证命令

repo 内自动化前置检查：

- `env UV_CACHE_DIR=/tmp/uv-cache uv run --all-packages python -m unittest tests.evals.test_retrieval_benchmark tests.evals.test_golden_cases`

retrieval benchmark：

- `uv run --all-packages python -m campus_evals.retrieval_benchmark --qrels packages/evals/fixtures/curriculum_plan_retrieval_qrels.json --results <run-results.json>`

workflow/status deterministic gate：

- `uv run --all-packages python -m unittest tests.evals.test_golden_cases`

## 当前完成语义

截至 2026-03-28，本 runbook 负责的不是“证明 live gate 已经重跑完成”，而是：

- 把 curriculum live gate 的执行顺序固定下来
- 把 repo-tracked fixture 与 live evidence 的对应关系固定下来
- 为后续 fresh rerun 提供统一 artifact contract
