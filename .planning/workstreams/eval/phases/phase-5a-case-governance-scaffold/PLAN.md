---
doc_type: phase_plan
phase: "5A"
phase_name: "Case Governance Scaffold"
status: completed
created: 2026-04-29
updated: 2026-04-29
---

# Phase 5A Plan: Case Governance Scaffold

## Objective

在不等待完整语料覆盖的前提下，补齐 shared eval 的 case governance scaffold。

本 phase 不扩编正式 accepted golden dataset；它冻结后续扩编必须遵守的生命周期、denominator、
workflow trace、candidate intake 与 drift/admission 规则。

## Locked Inputs

- `Phase 1-4` 已完成，不回滚 runtime / artifact / publish / automation owner boundary。
- `Phase 5` umbrella 已拆分；数据量不足只阻塞 `Phase 5B`。
- domain truth owner 继续属于 handbook / curriculum / notice / official-web /
  campus-services 等对应 workstream。
- eval 只拥有 shared case family、artifact family、candidate intake 与 acceptance governance。

## Deliverables

### 1. Case Lifecycle And Review Decision Contract

冻结 repo-owned case lifecycle：

- `candidate`
- `pending_review`
- `accepted_smoke`
- `accepted_regression_locked`
- `accepted_release_gate`
- `exploratory`
- `rejected`
- `duplicate`
- `needs_info`
- `retired`

每个 accepted case 必须重新写成 eval-owned case model；operator / feedback / trace
candidate 不得原样提升为 golden truth。

### 2. Denominator Registry Scaffold

建立 shared denominator registry，用于描述每个 admitted surface / tool / capability
family 当前应该被哪些 eval family 覆盖。

第一版 registry 至少覆盖：

- `student_rules`
- `curriculum_plan`
- `official_web/stable_reference`
- `official_web/fresh_news`
- `service_status_lookup`
- `transport_schedule_lookup`
- `service_guide_lookup`
- `contact_directory_lookup`
- public chat feedback / operator quality intake

registry 只表达 denominator expectation，不 author domain truth。

### 3. Workflow Trace Governance

让 workflow trace 成为一等 eval family，而不是 answer-quality 的附属字段。

需要冻结：

- `workflow_trace_summary` shape
- `orchestration_case_results` shape
- `direct_vs_delegate_branch_correctness`
- `handoff_correctness`
- `tool_argument_precision`
- `guardrail_correctness`
- `fail_close_correctness`
- `trace_projection_completeness`

artifact 只保存 sanitized summary、request / trace correlation、版本摘要与 safe
links，不保存 raw transcript、provider raw response、raw retrieval backend dump、
JWT、cookies 或 auth envelope。

### 4. Candidate Intake Manifest

补齐 eval-owned pending review manifest：

- intent mined candidate
- operator badcase candidate
- negative answer feedback candidate
- future workflow trace candidate

candidate intake 只能产生 `pending_review`，不能直接进入 `accepted_*`。

### 5. Drift And Admission Discipline

冻结以下规则：

- serving surface 变化时，domain owner 先更新 truth，再由 eval 更新 denominator / fixture。
- `release_gate` 只放上线门禁关键场景。
- `regression_locked` 只放高风险、已确认、不可静默重写的长期回归。
- `exploratory` 和 `pending_review` 只报告，不阻塞 CI。
- single-run failure 不能直接改 repo baseline。

## Non-Goals

- 不扩编大规模 accepted case。
- 不替代 handbook / curriculum / notice / official-web / campus-services 的 domain
  truth authoring。
- 不实现 retrieval、tool、panel 或 supervisor runtime 功能。
- 不持久化 raw prompt、raw answer、provider raw response、auth material 或未裁剪
  restricted payload。

## Acceptance Criteria

- Phase 5A docs 明确 current execution path，不再被完整数据量 blocker 卡住。
- shared case lifecycle / review decision contract 有 repo-owned 文档或模型承载。
- denominator registry scaffold 存在，并覆盖当前 admitted eval surfaces 与 opened
  campus-services tools。
- workflow trace artifact contract 与 `packages/evals` artifact serialization 形状对齐。
- quality feedback / operator candidate intake 能产生 pending-review manifest。
- drift / admission rules 有测试或文档 gate 防止 accepted case 被静默改写。

## Verification

- `git diff --check -- .planning/WORKSTREAMS.md .planning/workstreams/eval`
- `uv run --all-packages python -m unittest tests.evals.eval_admission_suite`
- `uv run --all-packages python -m unittest tests.evals.test_formal_benchmark tests.evals.test_live_benchmark`
