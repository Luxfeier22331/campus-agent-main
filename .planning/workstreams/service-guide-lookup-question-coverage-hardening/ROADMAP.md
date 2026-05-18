---
doc_type: roadmap
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Roadmap: Service Guide Lookup Question Coverage Hardening

Execution order is fixed:

`matrix freeze -> planner routing -> structured runtime -> agent answer shaping -> app-api rendering -> eval/release gate -> public/chat E2E subset -> closeout`

## Phase 0: Scope And Matrix Freeze

**Status:** completed

**Goal:** Freeze the service-guide question matrix and layer ownership before adding tests.

**Deliverables:**

- `QUESTION-MATRIX.md` with at least 24 cases.
- Matrix grouped by positive focus, boundary route and fail-close class.
- Explicit map from case family to test file / eval fixture owner.
- `MATRIX-COVERAGE-AUDIT.md` recording fixture strategy and current coverage status.

**Acceptance:**

- Matrix contains no `review_later` bucket.
- Every case has a target layer, fixture strategy and exactly one expected outcome.
- Out-of-scope data-plane/source-collection work is explicitly excluded.

## Phase 1: Planner Routing And Focus Classification

**Status:** completed

**Goal:** Make `supervisor-api` route service-guide questions to the right tool and focus.

**Implementation scope:**

- Extend planner golden cases in `apps/supervisor-api/internal/structuredplanning/planner_test.go`.
- Add or adjust deterministic routing for:
  - entry URL/link questions
  - procedure/how-to questions
  - required material/form questions
  - contact/phone/email questions
  - office-hour questions
  - eligibility/audience questions
  - broad full-guide questions
- Preserve boundary routing to calendar, schedule, status, contact directory and notice discovery.

**Acceptance:**

- All matrix routing cases pass.
- Boundary questions do not enter `service_guide_lookup`.
- Transaction requests remain guarded and do not generate service-guide execution handoff.

**Completion Evidence:**

- Planner golden cases and runtime policy capability tests cover the Phase 1 matrix rows.
- Focus classification now distinguishes entry, procedure, required-materials, contact,
  office-hours, eligibility and broad full-guide questions.
- Boundary routing remains assigned to academic calendar, transport schedule, service status,
  contact directory and notice discovery owners.

## Phase 2: Structured Runtime Lookup And Fail-Close Semantics

**Status:** completed

**Goal:** Make Go structured query runtime enforce requested guide focus and field availability.

**Implementation scope:**

- Extend `apps/supervisor-api/internal/structuredquery/runtime_service_guide_test.go`.
- Verify field-level fail-close for missing URL/contact/hours/materials/eligibility fields.
- Verify `entry_refs.url` vs `source_refs` semantics.
- Verify focused section selection for grouped procedure records.

**Acceptance:**

- Entry questions with only source refs fail closed when no `entry_refs.url` exists.
- Contact questions with no phone/email fail closed for contact focus.
- Office-hour/material/eligibility questions do not fall back to unrelated procedure text.
- `full_guide` remains allowed only for broad guide questions.

**Completion Evidence:**

- Go structured runtime tests now cover entry URL selection, source-ref provenance-only semantics,
  contact/hours/materials/eligibility missing-field fail-close, grouped procedure selection,
  campus-card entry/contact focus and academic-calendar entry URL lookup.
- Runtime fail-close keeps requested-focus absence as `temporarily_unverifiable` with
  `field_not_provided_by_source`.

## Phase 3: Campus Services Agent Answer Shaping

**Status:** completed

**Goal:** Ensure `campus-services-agent` produces concise, focus-aware, source-safe answers.

**Implementation scope:**

- Extend `tests/agent/test_campus_services_agent.py`.
- Cover user-facing phrasing for every guide focus.
- Assert `must_contain` / `must_not_contain` from matrix.
- Assert safe observability details include selected focus and source summary without raw locator
  leakage.

**Acceptance:**

- Agent answers include requested facts and omit unrelated guide sections.
- Missing fields produce clear unavailable wording.
- Answers do not expose release ids, projection ids, raw source refs as user instructions or debug
  fields.

**Completion Evidence:**

- Python agent tests cover entry, procedure, required-materials, contact, full-guide and unavailable
  wording paths.
- Agent output now selects focus-specific facts, renders `entry_refs.url` as the user-facing
  entry, and avoids exposing raw `source_refs` / release ids in answer text.

## Phase 4: App-API Public Chat Rendering Contract

**Status:** completed

**Goal:** Prove browser-facing structured answers preserve service-guide semantics.

**Implementation scope:**

- Extend `apps/app-api/test/chat-command.service.core.structured.suite.ts`.
- Cover entry, procedure, materials and fail-close answer rendering.
- Keep Vitest execution through `test/chat-command.service.test.ts`.

**Acceptance:**

- Public answer text carries source-safe service-guide facts.
- Source URL cards use user-facing URLs where available.
- Fail-close answers do not invent missing data or route to generic RAG.

**Completion Evidence:**

- App-api structured answer test covers service-guide procedure, entry and full-guide rendering
  with source-safe categories and browser-facing locator sanitization.
- The Vitest lane remains routed through `test/chat-command.service.test.ts`.

## Phase 5: Eval And Release Gate Integration

**Status:** completed

**Goal:** Make service-guide coverage durable in eval/release-gate tooling.

**Implementation scope:**

- Extend `packages/evals/src/campus_evals/service_guide_lookup_release_gate.py`.
- Extend `tests/evals/service_guide_lookup_release_gate_suite.py`.
- Extend `packages/evals/fixtures/public_chat_entry_cases.v1.json` for representative service-guide
  public-chat cases.
- Update eval README only if command/profile semantics change.

**Acceptance:**

- Gate artifact reports service-guide case counts by focus and boundary class.
- Gate fails when entry questions return procedure dumps or source-only URLs.
- Gate distinguishes deterministic fixture coverage from representative public-chat cases.
- Gate command remains deterministic and runnable via `uv run --all-packages python -m scripts.eval_gate accept --profile service-guide-lookup --json`.

**Completion Evidence:**

- Release gate artifact now includes `coverage.matrix` with 33 total cases, 20 positive
  service-guide cases, 7 boundary cases, 6 fail-close cases and focus counts.
- Release gate artifact now includes `coverage.public_chat_subset` mapping representative public
  entry cases back to matrix case ids.
- Gate subchecks run projection eval, intent gate, Go runtime/planner/policy tests, Python agent
  tests and app-api structured answer tests.

## Phase 6: Public Chat E2E Subset And Closeout

**Status:** completed

**Goal:** Verify representative service-guide questions through public/chat entry and close the
workstream.

**Implementation scope:**

- Run local public-chat entry fixture/eval subset for representative service-guide cases only.
- Record verification commands and artifacts in `STATE.md`.
- Add `GAP-LEDGER.md` if any accepted residual gaps remain.
- Mark workstream completed and update `.planning/WORKSTREAMS.md`.

**Acceptance:**

- Local deterministic test lanes pass.
- Representative public-chat service-guide subset passes or any failure is assigned to
  `public-chat-campus-services-e2e-acceptance`.
- Workstream has no active medium-or-higher unresolved issue within its scope.

**Completion Evidence:**

- Public-chat fixture includes representative service-guide entry, procedure and required-materials
  cases.
- `GAP-LEDGER.md` records no active in-scope medium-or-higher residual gaps.
- `.planning/WORKSTREAMS.md` moves this workstream to Completed with an explicit reopen rule.
