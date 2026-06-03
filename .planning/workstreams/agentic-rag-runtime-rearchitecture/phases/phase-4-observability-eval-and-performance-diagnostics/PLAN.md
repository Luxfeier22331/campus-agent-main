---
doc_type: plan
status: active
created: 2026-05-04
updated: 2026-05-04
---

# Phase 4 Plan

## Objective

让 relevancy / faithfulness 问题变成可诊断、可分解、可回归的工程问题，而不是
“模型感觉不对”。
本 phase 要产出具体观测 schema、perf breakdown contract 和 regression fixture 口径。

## Tasks

1. 补齐 stage-level observability
   - planner / retrieval / evidence / synthesis / grounding 都要有摘要
   - failure class 和 latency 分开记录
   - 每条 summary 至少承载 `request_id`、`plan_id`、`query_mode`、`stage_name`、
     `stage_status`、`candidate_count`、`supporting_evidence_count`、`grounding_verdict`、
     `failure_reason` 与 stage latency

2. 建立 eval 归因口径
   - relevancy / faithfulness / unsupported / presentation failure / no-answer 需要分开看
   - 不用最终分数掩盖 stage 问题
   - 每类 failure 至少对应一条可复现 regression fixture

3. 拆解 ragas / diagnostic 慢点
   - 区分 retrieval、prompt、adapter、scorer、optional dependency noise
   - 不把 PyTorch / embedding provider 告警误当成主问题
   - 把 diagnostic 运行的主要时延拆成 `retrieval_ms`、`prompt_ms`、`adapter_ms`、
     `diagnostic_ms` 与 dependency wait

4. 建立 regression fixture
   - 收集可复现低分样本
   - 作为后续关闭 heuristic 的证据
   - fixture 要能映射到具体 stage / breakdown 字段

## Constraints

- eval owner 仍在 `eval` workstream
- 本 phase 只补 rag-agent 侧可观测和可诊断面
- 不让诊断数据泄漏 raw provider trace

## Verification

- focused eval / diagnostic runs
- trace summary review
- `git diff --check`
- observation schema review against at least one failure-class sample
- perf breakdown report review that distinguishes runtime cost from diagnostic cost

## Exit Criteria

- 低分可归因到具体 stage
- 诊断慢点可区分为真实 runtime 开销与工具开销
- 至少一个 regression fixture 能同时证明 attribution 与 perf breakdown 口径可用
