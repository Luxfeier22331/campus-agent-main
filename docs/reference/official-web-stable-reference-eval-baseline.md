---
doc_type: reference
truth_scope: eval
owner_boundary: packages/evals
status: active
created: 2026-04-05
updated: 2026-05-13
---
# Official Web Stable Reference Eval Baseline

## 目的

本文记录 `official_web/stable_reference` 的稳定评估基线：

- repo-tracked denominator 是什么
- retrieval 与 live gate 的 accepted baseline 是什么
- 这些数值应该如何被解释
- 后续 rerun 何时应更新本文

边界：

- bootstrap release 的一次性执行证据已单独降到 historical snapshot
- live rebuild、release、alias publish 的执行步骤仍以 runbook 为准
- 本文不承担当前执行状态板，也不长期暴露 `.tmp` artifact 路径

## Baseline Contract

repo-tracked 基线入口固定为：

- split manifest:
  `configs/ingestion/official_web/stable_reference/split-manifest.v1.json`
- retrieval qrels:
  `packages/evals/fixtures/official_web_stable_reference_retrieval_qrels.json`
- deterministic live gate: `packages/evals/src/campus_evals/scenarios.py` ->
  `official_web_stable_reference_release_gate_cases()`
- live benchmark entry: `uv run --all-packages python -m
  campus_evals.official_web_live_benchmark ... --official-web-scope
  stable_reference`

基线分母：

- `4` retrieval qrels cases:
  - `3` positive stable-reference page cases
  - `1` no-hit case
- `5` deterministic live-gate cases:
  - `3` completed stable reference pages
  - `2` fail-close cases for freshness-sensitive / unanchored asks

## Accepted Baseline Snapshot

accepted baseline 目前固定采用 `2026-05-14` 这一轮 repo-tracked denominator：

- validated physical collection：待下一次 stable_reference rebuild / publish 产出
- later published alias：`official_web_stable_reference`
- retrieval baseline：
  - `total_cases = 4`
  - `positive_cases = 3`
  - accepted metric snapshot：待下一次 rebuild / live benchmark 后更新
- deterministic live gate：
  - `benchmark_type = official_web_stable_reference_live_gate`
  - `total_cases = 5`
  - `completed = 3`
  - `no_answer = 2`
  - accepted metric snapshot：待下一次 rebuild / live benchmark 后更新

## 基线解释

- `no_answer = 2` 是预期的 fail-close 行为，不应误判为 gate 漏测
- `precision_at_5 < 1.0` 在这里不构成失败，因为 stable reference 允许多条高相关说明型页面共同进入前五
- 当前 split 只包含已经通过 target-inventory/source-pack lineage 且有本地 artifact proof 的文档：
  `学校简介`、`教学和科研单位`、`中央民族大学大学教育收费公示表`
- `学术名流` 只是一个暴露问题的样本；品牌历史 / 人物介绍、基金会/校友会介绍、旧教育培养说明、
  新闻解释和讲座预告都不属于默认 institutional reference denominator。它们可以保留在
  source/inventory audit truth，但不进入当前 `official_web/stable_reference` split、qrels、
  RAGAS preferred set 或 live gate。
- 物理 collection 与 alias 路径只要承载同一份 validated document set，本基线可沿用；真正的 rebuild /
  publish 操作仍应看 runbook

## 维护规则

- 这份文档只保存稳定分母、关键数值和解释边界
- 新一轮 rerun 只在以下情况更新这里：
  - split manifest 改变
  - qrels denominator 改变
  - live gate case denominator 改变
  - accepted baseline verdict 改变
- 一次性 `.tmp` artifact、排障过程和历史 rerun 证据不再长期挂在本文

## 验证命令

- retrieval benchmark：
  - `uv run --all-packages python -m campus_evals.retrieval_live_benchmark
    --qrels
    packages/evals/fixtures/official_web_stable_reference_retrieval_qrels.json
    --qdrant-collection-name <collection> --format json --output <results.json>`
- deterministic live gate：
  - `uv run --all-packages python -m campus_evals.official_web_live_benchmark
    run --official-web-scope stable_reference --qdrant-collection-name
    <collection> --output-dir <output_dir>`
