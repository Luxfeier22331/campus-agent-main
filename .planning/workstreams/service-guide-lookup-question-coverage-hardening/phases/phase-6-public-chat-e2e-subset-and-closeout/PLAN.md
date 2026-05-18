---
doc_type: phase_plan
workstream: service-guide-lookup-question-coverage-hardening
phase: phase-6-public-chat-e2e-subset-and-closeout
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Phase 6 Plan: Public Chat E2E Subset And Closeout

## Goal

Run the representative service-guide public/chat subset, record evidence, and close the workstream
without taking ownership of unrelated campus-services tools.

## Inputs To Inspect

- `packages/evals/fixtures/public_chat_entry_cases.v1.json`
- `tests/evals/public_chat_entry_e2e_suite.py`
- `packages/evals/src/campus_evals/service_guide_lookup_release_gate.py`
- `.planning/workstreams/public-chat-campus-services-e2e-acceptance/`
- This workstream's `STATE.md`, `ROADMAP.md`, `REQUIREMENTS.md` and `QUESTION-MATRIX.md`

## Tasks

1. Run targeted deterministic lanes from Phases 1-5.
2. Run public-chat entry subset only for matrix cases marked `public_chat_fixture`.
3. Record commands, pass/fail and artifact paths in `STATE.md`.
4. Add `GAP-LEDGER.md` only if any residual gap is accepted; otherwise state there are no active
   in-scope medium-or-higher gaps.
5. Update `MATRIX-COVERAGE-AUDIT.md` final status.
6. Mark phases completed in `ROADMAP.md`.
7. Update `.planning/WORKSTREAMS.md` from Active to Completed.

## Exit Criteria

- All targeted local deterministic lanes pass.
- Public-chat service-guide subset passes, or failures are assigned to
  `public-chat-campus-services-e2e-acceptance` without keeping this matrix hardening line open.
- Workstream closeout explains what was hardened and when to reopen.

## Completion Evidence

- Public-chat entry fixture includes representative service-guide procedure, entry and
  required-materials cases.
- `MATRIX-COVERAGE-AUDIT.md` records all matrix rows as covered or intentionally not required for
  that layer.
- `GAP-LEDGER.md` records no accepted in-scope medium-or-higher residual gaps.
- `.planning/WORKSTREAMS.md` moves this workstream from Active to Completed.

## Verification

```bash
cd apps/supervisor-api && go test -count=1 ./internal/structuredplanning ./internal/structuredquery -run 'ServiceGuide|PlanGoldenCases'
uv run --all-packages python -m unittest tests.agent.test_campus_services_agent tests.evals.public_chat_entry_e2e_suite tests.supervisor.agents_sdk_runner_suite tests.evals.service_guide_lookup_release_gate_suite -q
pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/chat-command.service.test.ts -t 'renders campus-services answers from structured tool facts and safe source categories'
uv run --all-packages python -m scripts.eval_gate accept --profile service-guide-lookup --json
pnpm exec markdownlint-cli2 .planning/workstreams/service-guide-lookup-question-coverage-hardening/README.md .planning/workstreams/service-guide-lookup-question-coverage-hardening/REQUIREMENTS.md .planning/workstreams/service-guide-lookup-question-coverage-hardening/ROADMAP.md .planning/workstreams/service-guide-lookup-question-coverage-hardening/STATE.md .planning/workstreams/service-guide-lookup-question-coverage-hardening/QUESTION-MATRIX.md .planning/workstreams/service-guide-lookup-question-coverage-hardening/phases/phase-*/PLAN.md .planning/WORKSTREAMS.md
git diff --check -- .planning/workstreams/service-guide-lookup-question-coverage-hardening .planning/WORKSTREAMS.md
```
