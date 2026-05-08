---
doc_type: state
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# State: Service Guide Lookup Question Coverage Hardening

## Current Status

- status: `completed`
- current phase: `closed`
- current slice: Phase 0-6 completed and verified
- owner: current Codex session

## Completed Objective

Created and enforced a durable `service_guide_lookup` question coverage contract across planner,
structured runtime, campus-services-agent, app-api, eval/release gate and representative public-chat
entry evidence.

## Completed Work

- Phase 0: froze a 33-case matrix with no `review_later`, ambiguous outcome or data-plane import
  request.
- Phase 1: completed planner routing and focus classification for entry, procedure, materials,
  contact, office-hours, eligibility, full-guide, boundary and guarded transaction questions.
- Phase 2: completed Go structured runtime lookup and fail-close coverage for requested guide focus,
  `entry_refs.url` action URL semantics and provenance-only `source_refs`.
- Phase 3: completed campus-services-agent answer shaping for focus-aware answers, unavailable
  wording and safe observability details.
- Phase 4: completed app-api structured answer rendering contract for browser-facing service-guide
  answers and source-safe categories.
- Phase 5: completed eval/release-gate integration, including machine-readable matrix coverage and
  representative public-chat subset metadata in the release gate artifact.
- Phase 6: completed public-chat subset evidence and closeout docs.

## Final Coverage Denominator

- total cases: 33
- positive `service_guide_lookup` cases: 20
- boundary / non-service-guide cases: 7
- fail-close / guarded cases: 6
- focus counts:
  - `entry`: 5
  - `procedure`: 4
  - `required_materials`: 3
  - `contact`: 3
  - `office_hours`: 2
  - `eligibility`: 2
  - `full_guide`: 1
- representative public-chat service-guide subset:
  - `public-entry-campus-card-loss-guide`
  - `public-entry-academic-calendar-guide-entry`
  - `public-entry-public-medical-materials`
  - `public-entry-vpn-login-entry`

## Final Verification Evidence

Verification commands run during closeout:

```bash
uv run --all-packages python -m unittest tests.evals.service_guide_lookup_release_gate_suite.ServiceGuideLookupReleaseGateTest.test_release_gate_artifact_reports_question_matrix_coverage -q
uv run --all-packages python -m unittest tests.evals.service_guide_lookup_release_gate_suite -q
cd apps/supervisor-api && go test -count=1 ./internal/structuredplanning ./internal/structuredquery -run 'ServiceGuide|PlanGoldenCases'
uv run --all-packages python -m unittest tests.agent.test_campus_services_agent tests.evals.public_chat_entry_e2e_suite tests.supervisor.agents_sdk_runner_suite tests.evals.service_guide_lookup_release_gate_suite -q
pnpm --dir apps/app-api exec vitest run -c vitest.node.config.mts test/chat-command.service.test.ts -t 'renders campus-services answers from structured tool facts and safe source categories'
uv run --all-packages python -m scripts.eval_gate accept --profile service-guide-lookup --json
pnpm exec markdownlint-cli2 .planning/workstreams/service-guide-lookup-question-coverage-hardening/README.md .planning/workstreams/service-guide-lookup-question-coverage-hardening/REQUIREMENTS.md .planning/workstreams/service-guide-lookup-question-coverage-hardening/ROADMAP.md .planning/workstreams/service-guide-lookup-question-coverage-hardening/STATE.md .planning/workstreams/service-guide-lookup-question-coverage-hardening/QUESTION-MATRIX.md .planning/workstreams/service-guide-lookup-question-coverage-hardening/PLANNING-REVIEW.md .planning/workstreams/service-guide-lookup-question-coverage-hardening/MATRIX-COVERAGE-AUDIT.md .planning/workstreams/service-guide-lookup-question-coverage-hardening/GAP-LEDGER.md .planning/workstreams/service-guide-lookup-question-coverage-hardening/phases/phase-*/PLAN.md .planning/WORKSTREAMS.md
git diff --check -- .planning/workstreams/service-guide-lookup-question-coverage-hardening .planning/WORKSTREAMS.md apps/supervisor-api/internal/structuredplanning apps/supervisor-api/internal/runtimepolicy apps/supervisor-api/internal/structuredquery configs/runtime/intent-policy.v1.json packages/campus-services-agent tests/agent apps/app-api/test/chat-command.service.core.structured.suite.ts packages/evals tests/evals
```

Results:

- release-gate coverage artifact regression test: passed
- `tests.evals.service_guide_lookup_release_gate_suite`: 8 tests passed
- Go focused planner/structuredquery lane: passed
- Python focused workstream lane: 58 tests passed
- app-api structured answer Vitest lane: 1 passed, 31 skipped
- service-guide release gate: passed

Latest release gate artifact:

- `.tmp/evals/service-guide-lookup-release-gate-accept-20260507T160638/service-guide-lookup-release-gate.json`

## Blockers

- None.

## Residual Gaps

- No active in-scope medium-or-higher gaps remain for this workstream.
- Broad real public-chat campus-services entry/staging opening remains owned by
  `public-chat-campus-services-e2e-acceptance`, not this coverage-hardening line.

## Reopen Rule

Reopen this workstream only if a `service_guide_lookup` matrix class regresses: planner focus
classification drifts, runtime substitutes unrelated guide fields for missing requested facts,
`source_refs` are treated as action URLs, browser-facing answers expose internal locators, release
artifact loses matrix/public-chat coverage metadata, or a new service-guide focus class is admitted
without matrix ownership.
