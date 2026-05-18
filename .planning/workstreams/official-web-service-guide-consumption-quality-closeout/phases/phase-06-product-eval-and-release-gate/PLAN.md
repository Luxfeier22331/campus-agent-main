---
doc_type: plan
status: active
created: 2026-05-04
updated: 2026-05-04
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Plan: Product Eval And Release Gate

## Goal

Turn official-web-backed service-guide product questions into deterministic release gates.

## Inputs

- Phase 4 `SUMMARY.md`
- Phase 5 `SUMMARY.md`
- `packages/evals/src/campus_evals/official_web_selected_write_preview_runtime_verifier.py`
- `packages/evals/fixtures/tool_family_denominators.v1.json`
- `packages/evals/fixtures/provider_function_tools.v1.json`
- `packages/evals/fixtures/workflow_trace_gate_cases.v1.json`

## Tasks

1. Add product-question cases for at least:
   - `VPN入口在哪里`
   - `VPN客户端怎么安装`
   - `校园网认证入口在哪里`
   - `邮箱申请需要什么表`
   - `信息公开怎么申请`
   - `校园卡丢了怎么办`
2. Define deterministic focus thresholds for each case:
   - expected planner `guide_focus`
   - max selected section count
   - max answer character budget
   - required tokens
   - forbidden unrelated tokens
   - required source URL coverage
   - required field-source coverage
3. Extend or add focused release gate for service-guide official-web product questions.
4. Gate task-scope/full-impact selected-write semantics in artifacts.
5. Ensure gate fails if:
   - VPN entry answer returns full procedure dump
   - procedure answer includes unrelated modes
   - source refs are missing
   - planner focus and runtime selected sections disagree

## Acceptance Criteria

- All six product questions have deterministic eval coverage.
- Gate output is machine-readable and records pass/fail reasons per threshold.
- Gate catches planner focus drift, runtime section drift and source-ref drift independently.
- No eval case depends on live official-web fetching.

## Verification

```bash
uv run --all-packages python -m unittest discover -s tests -t . -p '*eval*'
uv run --all-packages python -m scripts.eval_gate accept --profile campus-services-product-path --json
uv run --all-packages ruff check packages/evals tests
```

## Done Summary Template

When complete, write `SUMMARY.md` with:

- product-question dataset
- threshold definitions
- gate command and artifact path
- failure modes covered
- verification evidence
