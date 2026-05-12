---
doc_type: reference
status: active
created: 2026-04-23
updated: 2026-04-29
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

### Observation-Backed Profile Reports

Phase 8-13 deterministic profile gates write `profile-report.json` with
`schema_version = eval_profile_gate.v1`. This artifact is not a formal
`run-XX-case-results.json` and is not directly publishable to operator
observability, but it is the canonical input for profile-specific release,
scheduled and operations-governance checks.

Admitted profile ids, deprecated aliases, runner kinds, default reruns and
artifact kinds are owned by `campus_evals.profile_registry`. The repo-owned
configuration audit is `uv run --all-packages python -m scripts.eval_gate audit`;
it must cover the registry, GitHub Actions dispatch choices, operations policy,
denominator registry and profile fixture smoke.

Stable fields:

- `profile_id`
- `case_family`
- `passed`
- `summary.total`
- `summary.passed`
- `summary.failed`
- `summary.overall_passed`
- `summary.started_at` / `summary.finished_at`
- `summary.runtime_seconds`
- `summary.retry_count`
- `summary.provider_calls`
- `summary.collector_version`
- `summary.runtime_profile`
- `summary.metrics_missing`
- `version_summary.case_set_version`
- `version_summary.policy_artifact`
- `version_summary.runtime_version`
- `version_summary.git_head`
- `sanitized_results[].case_id`
- `sanitized_results[].passed`
- `sanitized_results[].request_correlation` when runtime collection can safely
  correlate the case to app-api request / trace truth

The artifact must not contain raw prompt, raw transcript, provider raw
response, auth material, restricted payload, cookies, JWTs, bearer tokens or
token-bearing URL values.

Profile reports remain separate from formal `run-XX-case-results.json`.
Operator backflow for profile reports must use the explicit `publish-profile`
path, which publishes only correlated `sanitized_results` and skips
uncorrelated cases with a reason.

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

默认优先读取 inline `request_correlation`；外部 manifest 只作为显式第二来源。

`workflow_trace_summary` 是 sanitized orchestration trace projection，至少允许承载：

- `routing_frame`
- `context_resolution`
- `planning_outcome`
- `direct_vs_delegate_branch`
- `handoff`
- `selected_target`
- `selected_tools`
- `tool_argument_summary`
- `trace_steps`
- `tool_call_summaries`
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
- `tool_order_correctness`
- `tool_result_status_correctness`
- `fail_close_provenance`
- `evidence_source_selection`

固定规则：

- workflow trace artifact 只保存 sanitized summary，不保存 raw prompt、raw transcript、
  provider raw response、raw retrieval backend dump、JWT、cookies、auth envelope、restricted
  document payload 或 raw restricted payload
- external trace ids / grader ids 只能作为 backlink；不能替代 repo-owned case truth 或
  release verdict
- direct structured runtime case 与 Python delegate case 都必须可落到同一
  `workflow_trace_summary` shape，避免形成两套不可比的 artifact
- repo-owned workflow trace runtime gate 固定由
  `campus_evals.workflow_trace_gate` 消费 `workflow_trace_summary`，并将
  deterministic verdict 写回
  `orchestration_case_results`

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

### Candidate Review Manifests

operator quality candidate export 可以进入 eval-owned review manifest，但仍不能跳过人工/评测 owner
复核。

固定规则：

- `GET /api/operator/quality/eval-candidates` 输出的是 pending candidate，不是 golden truth
- `packages/evals` 只能先把 operator badcase / negative feedback candidate 包成
  `pending_review` manifest
- negative feedback manifest 不保存 raw transcript、raw auth material、provider raw response、raw
  prompt 或 retrieval payload
- accepted case 必须重新写成 eval-owned case model；不得把 app-api candidate JSON 原样提升为
  benchmark artifact truth
- `campus_evals.observed_regression_review apply` 是 observed regression review/admission
  的 repo-owned apply step；它消费 pending manifest 和 review decisions，输出 reviewed
  manifest 与 accepted fixture
- accepted review decision 至少记录 `source_request_id`、`trace_id`、`sampled_at`、
  `source_surface`、`observed_failure_class`、`reviewer`、`reason` 与 `target_suite`
- `duplicate` decision 必须记录 `duplicate_of`；`rejected`、`deprecated` 与
  `needs_info` 只留在 reviewed manifest，不进入 accepted fixture

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
- `workflow_trace_gate.v1` artifact/runtime gate
- `public_chat_product_path`
- `service_status_lookup`
- `transport_schedule_lookup`
- `service_guide_lookup`
- `contact_directory_lookup`
- `campus_notice_discover`
- `campus_notice_get`
- `multimodal_ocr_document_quality`
- `restricted_authz_privacy`
- `agentic_retrieval_plan`
- `eval_operations_governance`
- `tool_routing_product_path`
- `public_chat_entry_e2e`
- `answer_quality_contract`
- `multi_agent_runtime_contract`

后续新 corpus 只有在：

- 已有 stable profile entrypoint
- 已有 deterministic/live gate
- 已冻结 serving surface

之后才允许复用这份 contract。
