---
doc_type: summary
status: accepted
created: 2026-04-27
updated: 2026-04-27
---

# Phase 5 Summary: Campus Services Product-path Opening Gate

## Delivered

- 新增 `campus-services-product-path` shared eval profile，并绑定到
  `scripts.eval_gate accept --profile campus-services-product-path`。
- 新增 opening gate runner：
  `packages/evals/src/campus_evals/campus_services_product_path_opening_gate.py`。
- opening gate 聚合以下 check lanes：
  - `service-guide-lookup` deterministic release gate
  - `contact-directory-lookup` deterministic release gate
  - Go structured runtime matrix tests
  - Python `tests.agent.test_campus_services_agent`
  - `app-api` campus-services runtime tests
  - public/chat worker E2E (`apps/public-chat-web/test/worker.test.ts`)
  - `app-api` / `public-chat-web` typecheck
- 输出机器可读 artifact：
  `campus-services-product-path-opening-gate.json`，包含：
  - `schema_version: campus_services_product_path_opening_gate.v1`
  - `gate_id: campus_services_product_path`
  - check-level pass/fail、command/cwd、summary
  - tool-level verdict（`open` / `blocked`）与 failed checks
  - version summary（`generated_at`、`git_head`、runner）
  - local gate vs staging gate scope distinction

## Verification

- `uv run --all-packages python -m unittest tests.evals.campus_services_product_path_eval_gate_profile_suite tests.evals.campus_services_product_path_opening_gate_suite tests.test_eval_gate`
- `uv run --all-packages python -m unittest tests.evals.service_guide_lookup_eval_gate_profile_suite tests.evals.contact_directory_lookup_eval_gate_profile_suite`
- `uv run --all-packages ruff check scripts/eval_gate.py packages/evals/src/campus_evals/campus_services_product_path_opening_gate.py tests/evals/campus_services_product_path_eval_gate_profile_suite.py tests/evals/campus_services_product_path_opening_gate_suite.py`
- `git diff --check`

