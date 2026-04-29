---
doc_type: phase_context
phase: "5A"
phase_name: "Case Governance Scaffold"
status: active
created: 2026-04-29
updated: 2026-04-29
---

# Phase 5A Context

## Why This Phase Exists

`eval` Phase 1-4 已经完成 shared runtime / artifact / publish / automation 收口，但 Phase 5 原计划把
case governance 与正式 golden dataset 扩编绑在一起，并整体等待采集内容补全。

这会阻塞本来不依赖数据量的工作：

- case lifecycle
- denominator registry
- workflow trace artifact model
- pending-review candidate intake
- drift / admission discipline

## Current Review Findings

- `packages/evals/README.md` 已记录 workflow trace eval gap。
- `docs/reference/eval-benchmark-artifact-contract.md` 已写入 `workflow_trace_summary` 与
  `orchestration_case_results`，但 artifact serializer 仍主要输出 `observed_trace`。
- `campus_evals.eval_admission` 已有 quality feedback manifest builder，但 CLI 只开放
  `intent-candidates`。
- `docs/contracts/app-api-operator-observability-http.md` 已冻结 operator quality eval candidate
  export seam，但 eval workstream 还没有完整接住。

## Boundary

Phase 5A 只补 shared scaffold，不声明数据已足够，不推进 accepted case 扩编。
