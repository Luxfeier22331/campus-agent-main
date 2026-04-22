---
workstream: eval
created: 2026-04-22
updated: 2026-04-24
---

# Project State

## Current Position

**Status:** Active
**Current Phase:** 5
**Current Phase Name:** Golden Dataset And Case Governance
**Current Plan:** `phases/phase-5-golden-dataset-and-case-governance/PLAN.md`
**Total Phases:** 5
**Total Plans in Phase:** 1
**Progress:** 4/5 phases complete
**Last Activity:** 2026-04-24
**Last Activity Description:** 已把 shared benchmark core neutralize、artifact contract、publish/backflow seam、`scripts.eval_gate` 与 manual release-gate workflow 收编进 eval workstream；当前只剩 `golden dataset` governance 等待采集内容补全。

## Current Slice

- 这条 workstream 已完成 shared eval substrate 的前四层收口：
  - `packages/evals` shared core 从 handbook 语义收口到 neutral `formal_benchmark`
  - shared artifact contract 已冻结到 `docs/reference/eval-benchmark-artifact-contract.md`
  - `app-api` internal eval ingress 与 operator publish/backflow seam 已冻结到 contract/docs + code + tests
  - `scripts.eval_gate` 与 `.github/workflows/eval-release-gate.yml` 已成为 repo-owned automation entry
- 当前唯一未完成切片是 `Phase 5`：
  - coverage matrix / denominator truth
  - retrieval qrels shared governance
  - workflow/status case governance
  - deterministic answer truth governance
  - synthetic candidate intake governance
- 当前顺序保持冻结：
  - `golden dataset` 正式治理继续等待采集内容补全
  - 在采集内容补全之前，不启动 repo-wide denominator 扩编
  - handbook / curriculum / official-web 现有 admitted eval surface 继续由已冻结的 runtime/artifact/publish/automation 承接
- 当前明确排除：
  - domain case authoring 本体
  - retrieval / panel / tool feature 实现
  - operator read-model ownership
  - sink / grader 原始 payload 持久化真相

## Blockers

- 当前 blocker 只剩一个：采集内容尚未补全，因此 `golden dataset` shared governance 不能正式启动。
- 这不是 runtime / artifact / publish / automation 的 blocker；对应 phase 已落地完成。
- `docs/plans/archive/superseded/golden-dataset-execution-plan.md` 继续只保留为 supporting reference，不再承载 active progression。

## Verification

- Python eval/runtime verification:
  - `uv run --all-packages python -m unittest tests.evals.test_formal_benchmark tests.evals.test_live_benchmark tests.evals.test_handbook_live_benchmark tests.evals.test_curriculum_live_benchmark tests.evals.test_official_web_live_benchmark tests.evals.test_operator_observability tests.test_eval_gate tests.test_docs_structure`
- JS/TS seam verification:
  - `pnpm --dir apps/app-api test:node -- test/chat-requests.route.test.ts`
- planning/docs consistency:
  - `git diff --check -- .planning/WORKSTREAMS.md .planning/workstreams/eval/README.md .planning/workstreams/eval/ROADMAP.md .planning/workstreams/eval/STATE.md .planning/workstreams/eval/phases`

## Session Continuity

**Stopped At:** `eval` workstream 的 `Phase 1-4` 已完成并写实到 native phase docs；当前只剩 `Phase 5` 等待采集内容补全后启动。
**Resume File:** `.planning/workstreams/eval/phases/phase-5-golden-dataset-and-case-governance/PLAN.md`
