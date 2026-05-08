---
doc_type: requirements
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Requirements: Service Guide Lookup Question Coverage Hardening

## Goal

Make `service_guide_lookup` question behavior product-reliable by expanding deterministic coverage
from a few representative cases into a structured question matrix that spans routing, runtime
lookup, answer shaping, app-api rendering and eval/release-gate enforcement.

## Problem Statement

`service_guide_lookup` currently has core support for focused guide answers, public entry URLs and
field-level unavailable wording. The remaining risk is coverage drift:

- a user asks an entry question and receives a procedure dump
- a materials/contact/office-hours/eligibility question silently falls back to full guide text
- planner routes calendar, notice, transport schedule or contact-directory questions into
  `service_guide_lookup`
- answer rendering leaks internal fields such as release ids, source ref internals, raw projection
  details or unsupported debug vocabulary
- public/chat and eval coverage do not exercise the same contract as Go/Python unit tests

## In Scope

- Define and maintain a service-guide question matrix with:
  - `case_id`
  - `user_goal`
  - `expected_tool`
  - `expected_guide_focus`
  - `expected_outcome`
  - `must_contain`
  - `must_not_contain`
  - fixture strategy
  - layer coverage ownership
- Cover positive guide focuses:
  - `entry`
  - `procedure`
  - `required_materials`
  - `contact`
  - `office_hours`
  - `eligibility`
  - `full_guide` only when the user asks broad "what can I do / tell me about" questions
- Cover boundary routing away from `service_guide_lookup`:
  - `academic_calendar_lookup`
  - `transport_schedule_lookup`
  - `service_status_lookup`
  - `contact_directory_lookup`
  - `notice-agent` notice discovery/original retrieval where applicable
- Cover field-level fail-close:
  - URL-required entry question with no `entry_refs.url`
  - phone-required contact question with only department text
  - office-hours question with no hours field
  - material question with only generic procedure text
- Extend release gate and public-chat entry fixture so service-guide regressions are caught before
  product-path opening or rollout.
- Use synthetic runtime/agent fixtures where needed to test fail-close semantics. These fixtures
  are test inputs, not data-plane admission requests.

## Out Of Scope

- No broad official-web crawl.
- No source-truth recollection or selected-write import.
- No schema redesign unless existing `entry_refs`, `guide_sections`, `materials`,
  `contact_refs`, `office_hours` and `eligibility_notes` cannot express a required tested fact.
- No transaction execution, booking, submission, payment or work-order handoff.
- No supervisor-side generation of service-guide answers.
- No generic retrieval fallback when structured service-guide projection is missing.
- No migration of existing service-guide records.
- No `blocked_external_data`, `review_later` or ambiguous `A or B` outcome buckets in the matrix.

## Success Criteria

- The matrix includes at least 24 cases across positive, boundary and fail-close classes.
- Every matrix case has exactly one expected outcome.
- Planner tests prove expected tool and `guide_focus` for every matrix case that should enter
  campus-services planning.
- Go structured runtime tests prove focused lookup and fail-close behavior for each service-guide
  focus class.
- Python `campus-services-agent` tests prove user-facing answer shaping for every focus class,
  including source URL semantics and forbidden internal fields.
- App-api structured answer tests prove browser-facing public/chat rendering uses the same answer
  contract.
- `packages/evals` release gate includes the question matrix or a generated subset with explicit
  coverage counts.
- Public-chat entry fixture includes representative smoke/release-gate cases for entry, procedure,
  materials and one boundary route.
- Verification commands are recorded in `STATE.md` with pass/fail evidence.
- `MATRIX-COVERAGE-AUDIT.md` maps each case to code/eval owners and fixture strategy before
  implementation starts.

## Non-Negotiable Contracts

- `entry_refs.url` is the only user-facing service entry URL field.
- `source_refs` are provenance only and must not be substituted as an action URL.
- Requested-focus absence must produce no-answer / unavailable semantics, not unrelated guide
  dumping.
- `campus-services-agent` owns service-guide answer shaping; supervisor owns routing, admission,
  terminal semantics and finalization.
- Runtime lookup reads PostgreSQL current projection / typed read model; it does not parse raw
  official-web pages, handbook PDFs, notice HTML, OCR assets or object storage at query time.
- Synthetic fixtures are allowed only for tests that prove behavior already expressible by the
  current service-guide projection schema.
