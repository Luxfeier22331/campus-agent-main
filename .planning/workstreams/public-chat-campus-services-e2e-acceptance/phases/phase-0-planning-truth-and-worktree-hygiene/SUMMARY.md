---
doc_type: summary
status: completed
created: 2026-04-27
updated: 2026-04-27
phase: Phase 0
---

# Phase 0 Summary: Planning Truth And Worktree Hygiene

## Outcome

Phase 0 is complete.

This phase did not implement public/chat E2E product code. It established the active
workstream planning truth, classified the current dirty worktree, and verified that the
focused campus-services gates are green before Phase 1 starts.

## Planning Truth Updated

- `.planning/WORKSTREAMS.md`
  - moved `public-chat-campus-services-e2e-acceptance` to Active
  - recorded `Phase 0` completion and advanced current phase to `Phase 1`
- `.planning/workstreams/public-chat-campus-services-e2e-acceptance/README.md`
  - active workstream entry and boundary notes
- `.planning/workstreams/public-chat-campus-services-e2e-acceptance/REQUIREMENTS.md`
  - product-path E2E requirements, non-goals, tool matrix, success criteria
- `.planning/workstreams/public-chat-campus-services-e2e-acceptance/ROADMAP.md`
  - Phase 0 through Phase 6 execution order
- `.planning/workstreams/public-chat-campus-services-e2e-acceptance/STATE.md`
  - current state, prompt denominator, preconditions, verification plan
- `.planning/workstreams/campus-services-runtime-tool-gap-closeout/*`
  - companion planning updated to include `contact_directory_lookup`

## Worktree Hygiene Classification

Current worktree contains multiple logical change groups. Phase 1 must not mix them.

### In Scope For This Workstream

- `public-chat-campus-services-e2e-acceptance` planning files
- future Phase 1 public/chat E2E harness files
- future app-api / public-chat Worker tests that exercise the product path
- future shared `campus-services-product-path` gate profile

### Prerequisite But Separate From This Workstream

- contact directory runtime / adapter / eval work
  - `apps/supervisor-api/internal/structuredquery/contact_directory*`
  - `apps/supervisor-api/internal/httpapi/*contact*` wiring
  - `packages/campus-services-agent/*`
  - `packages/contracts/*`
  - `packages/evals/src/campus_evals/contact_directory_*`
  - `tests/agent`, `tests/contracts`, `tests/evals`

These files are needed as baseline capability, but Phase 1 should not keep expanding
their runtime semantics unless an E2E failure proves the product-path contract is wrong.

### Explicitly Out Of Scope For Phase 1 E2E

- ingestion worker deployment hardening
  - Dockerfile, entrypoint, systemd timers, report retention, deployment preflight
- authenticated notice / OCR / multimodal drain
  - raw ingestion OCR, source projection OCR, multimodal drain scripts
- WeChat official-account source-channel work
  - `wechat_public_notice` collector / projection / notice serving admission
- document site / canonical reader staging work
- public docs generated content
- source-truth / projection rebuild logic unrelated to a failing E2E preflight

## Verification Completed

- `cd apps/supervisor-api && go test ./internal/structuredquery ./internal/httpapi ./internal/runtimepolicy ./internal/structuredplanning`
  - passed
- `uv run --all-packages python -m unittest tests.agent.test_campus_services_agent`
  - passed
- `uv run --all-packages python -m scripts.eval_gate accept --profile service-guide-lookup --output-dir .tmp/evals/service-guide-lookup-phase0 --json`
  - passed
- `uv run --all-packages python -m scripts.eval_gate accept --profile contact-directory-lookup --output-dir .tmp/evals/contact-directory-lookup-phase0 --json`
  - passed
- `pnpm docs:lint`
  - passed

## Notes From Verification

- The first Go baseline run exposed a stale WeChat notice test expectation while the current
  worktree was moving `wechat_public_notice` into serving admission.
- Current worktree now has WeChat public notice admission tests and the focused Go baseline passes.
- This is recorded as a separate workstream interaction, not as a public/chat E2E requirement.

## Next Phase

Phase 1 should implement the local deterministic public/chat E2E harness and preflight.

Default Phase 1 posture:

- start with repo-owned Worker / test harness, not staging
- assert preflight readiness before product-path assertions
- avoid touching ingestion or projection builders unless the preflight itself proves they block E2E
