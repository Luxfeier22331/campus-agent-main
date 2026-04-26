---
doc_type: reference
status: active
created: 2026-04-23
updated: 2026-04-27
---
# Eval Benchmark Artifact Contract

## 目的

本文集中冻结 shared eval `run / repair / accept / publish` artifact 的稳定布局与语义。

它回答的是：

- accepted eval artifact 长什么样
- 哪些字段是 shared runtime truth
- operator publish / backflow 从哪里读取 canonical correlation

它不负责：

- 单个 corpus 的 denominator 与 accepted baseline 数值
- golden dataset 扩样顺序
- provider threshold / gate verdict 策略

## Shared Lifecycle

当前 shared eval artifact 固定分成三段：

- `run`
  - live benchmark 首轮执行
- `repair`
  - 只修复 transient infra failure
- `accept`
  - 汇总最终 verdict，并可选产出 operator publish summary

per-corpus entrypoint 可以不同，但 artifact 语义必须统一。

## Directory Layout

标准 acceptance 根目录：

```text
<accept-root>/
  accept-config.json
  final-summary.json
  operator-observability-publish-summary.json   # optional
  run/
    supplemental-runtime-events.jsonl           # optional
    supplemental-provider-summary.json          # optional
    run-XX-case-results.json
    run-XX-summary.json
    summary.json
    gate-report.json
    SUMMARY.md
  repair/                                       # optional
    supplemental-runtime-events.jsonl           # optional
    supplemental-provider-summary.json          # optional
    repair-config.json
    repair-plan.json
    run-XX-repair-results.json
    run-XX-case-results.json
    run-XX-summary.json
    summary.json
    gate-report.json
    SUMMARY.md
```

补充约束：

- `repair/` 只在存在 repair target 时出现
- accepted root 继续允许 corpus-specific baseline side artifact，但不能改写上述 shared file
  语义

## Stable Fields

### Case Results

`run-XX-case-results.json` 的共享重点字段：

- `results[].case_id`
- `results[].status`
- `results[].passed`
- `results[].metric_results`
- `results[].supplemental_results`
- `results[].request_correlation`
- `results[].workflow_trace_summary`
- `results[].orchestration_case_results`

`request_correlation` 是 operator publish 的 canonical first-party truth：

- `case_id`
- `request_id`
- `trace_id`
- `sampled_at`
- `trace_link`
- `issue_link`
- `issue_fingerprint`

默认优先读取 inline `request_correlation`；外部 manifest 只作为 fallback。

`workflow_trace_summary` 是 sanitized orchestration trace projection，至少允许承载：

- `routing_frame`
- `context_resolution`
- `planning_outcome`
- `direct_vs_delegate_branch`
- `handoff`
- `selected_target`
- `selected_tools`
- `tool_argument_summary`
- `guardrail_outcomes`
- `fail_close_reason`
- `runtime_versions`
- `policy_artifact_versions`

`orchestration_case_results` 是 workflow trace gate 的 per-case verdict summary，至少允许承载：

- `direct_vs_delegate_branch_correctness`
- `handoff_correctness`
- `tool_argument_precision`
- `guardrail_correctness`
- `fail_close_correctness`
- `trace_projection_completeness`

固定规则：

- workflow trace artifact 只保存 sanitized summary，不保存 raw prompt、raw transcript、
  provider raw response、raw retrieval backend dump、JWT、cookies 或 auth envelope
- external trace ids / grader ids 只能作为 backlink；不能替代 repo-owned case truth 或
  release verdict
- direct structured runtime case 与 Python delegate case 都必须可落到同一
  `workflow_trace_summary` shape，避免形成两套不可比的 artifact

### Run / Repair Summary

`summary.json` / `gate-report.json` 负责：

- deterministic verdict
- supplemental verdict
- workflow trace verdict
- provider runtime status
- repair provenance

它们不承担：

- app-api operator read-model truth
- browser-facing contract
- golden dataset case governance

### Acceptance Summary

`final-summary.json` 至少固定：

- `schema_version`
- `benchmark_type`
- `mode = acceptance`
- `initial_run_dir`
- `repair_run_dir`
- `deterministic_verdict`
- `supplemental_verdict`
- `final_overall_verdict`
- `provider_runtime`
- `runtime_observability`
- `operator_observability_publish`

`accept-config.json` 固定记录：

- reruns
- run / repair path
- runtime log path
- publish config

## Publish / Backflow Contract

operator publish 只允许从 accepted artifact 进入。

固定规则：

- publish 输入是最终 `run-XX-case-results.json`
- 若存在 repair，则优先消费 repaired case-results
- `operator-observability-publish-summary.json` 只记录 publish 结果，不反向定义 accepted
  verdict
- `dry-run=true` 时允许构建 batch，但不得 POST 到 app-api

## Current Admitted Surfaces

当前共享 artifact contract 已用于：

- `student_rules`
- `curriculum_plan`
- `official_web/stable_reference`
- `official_web/fresh_news`

后续新 corpus 只有在：

- 已有 stable profile entrypoint
- 已有 deterministic/live gate
- 已冻结 serving surface

之后才允许复用这份 contract。
