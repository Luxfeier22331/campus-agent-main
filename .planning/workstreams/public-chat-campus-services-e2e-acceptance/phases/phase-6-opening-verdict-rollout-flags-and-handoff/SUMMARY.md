---
doc_type: summary
status: accepted
created: 2026-04-27
updated: 2026-04-27
---

# Phase 6 Summary: Opening Verdict, Rollout Flags, And Handoff

## Delivered

- 收口 `campus-services-product-path` opening verdict：
  - `service_status_lookup`: `open`
  - `transport_schedule_lookup`: `open`
  - `service_guide_lookup`: `open`
  - `contact_directory_lookup`: `open`
  - `service_process_lookup`: `keep_closed`（不在本轮 opening 范围）
- 明确 rollout / rollback contract：
  - rollout gate: `SUPERVISOR_API_OPEN_CAPABILITIES=campus_services`
  - rollback: 从 `SUPERVISOR_API_OPEN_CAPABILITIES` 移除 `campus_services` 并重启 runtime
- 明确 source trace observation points：
  - `GET /readyz` 的 `preflight.campusServicesProductPath`
  - public-chat assistant `campus_service_trace_cards`
  - `requestExecution` 的 selected target / allowed tool / semantic outcome
- 回写 backlog handoff：
  - 将仍需收口的长期缺口写回
    `campus-services-runtime-tool-gap-closeout`（别名扩展、历史语义、service process
    后续开放等），不在本 workstream 继续堆 data-plane/source-truth 修复。

## Verification

- `uv run --all-packages python -m unittest tests.test_eval_gate`
- `uv run --all-packages python -m unittest tests.evals.campus_services_product_path_eval_gate_profile_suite`
- `uv run --all-packages python -m unittest tests.evals.campus_services_product_path_opening_gate_suite`
- `uv run --all-packages python -m scripts.eval_gate accept --profile campus-services-product-path --output-dir .tmp/evals/campus-services-product-path-opening-gate-local --json`
- `uv run --all-packages ruff check scripts/eval_gate.py packages/evals/src/campus_evals/campus_services_product_path_opening_gate.py tests/evals/campus_services_product_path_eval_gate_profile_suite.py tests/evals/campus_services_product_path_opening_gate_suite.py`
- `git diff --check`

