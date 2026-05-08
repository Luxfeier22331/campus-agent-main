---
doc_type: review
status: completed
created: 2026-05-07
updated: 2026-05-07
---

<!-- markdownlint-disable MD013 -->

# Planning Review

## Verdict

The workstream is valid and should proceed, but the initial plan had four planning defects that
would make execution ambiguous. This review records the defects and the fixes applied to the
planning truth.

## Findings And Fixes

| Finding | Severity | Problem | Fix |
| --- | --- | --- | --- |
| Non-deterministic matrix outcomes | High | Several cases used `resolved_current or temporarily_unverifiable`, which cannot be used as an acceptance contract. | Matrix outcomes are now deterministic. Cases that need missing-field behavior are represented as dedicated fail-close cases. |
| Data-plane drift risk | Medium | Phase 0 allowed `blocked_external_data`, which could turn this workstream into service-guide source collection or selected-write import work. | Phase 0 now requires fixture strategy classification and explicitly keeps source collection/import out of scope. |
| Boundary owner ambiguity | Medium | Boundary rows used loose owners such as `notice-agent / notice lookup` and `none / guarded terminal`. | Boundary rows now use precise owners such as `notice-agent:campus_notice_discover` and `guarded_terminal`. |
| Public-chat ownership overlap | Medium | Phase 6 language could be read as reopening broad `public-chat-campus-services-e2e-acceptance`. | Phase 6 now only verifies a representative service-guide subset and records broad public/chat ownership as external. |
| Coverage source ambiguity | Medium | The plan did not distinguish current source-truth records from synthetic fixtures needed to test missing fields. | Matrix now has explicit `Fixture Strategy`, and phase plans require fixture-backed tests instead of source-truth expansion. |

## Current Scope After Review

- This workstream remains a service-guide question coverage hardening line.
- It does not collect new official-web pages, handbook pages, notices or selected-write releases.
- It may add synthetic runtime/agent fixtures where required to test missing-field and fail-close
  behavior.
- It may add public-chat fixture/eval cases only as a representative service-guide subset.
- It must not use `review_later`, `manual_review_required` or uncertain outcome buckets.

## Execution Readiness

The workstream can enter Phase 0 after this review. Phase 0 should create
`MATRIX-COVERAGE-AUDIT.md` and confirm the matrix still maps cleanly to existing test/eval owners
before code changes begin.

## Implementation Review Update

Phase 0 and Phase 1 are now complete. A follow-up review fixed two drift issues found after initial
planner implementation:

- `信息公开联系电话是多少` is now only a `contact_directory_lookup` boundary case. The
  service-guide contact case is explicitly `信息公开申请联系电话是多少`.
- Card-loss cues such as `丢了`, `遗失` and `挂失` are no longer full-guide focus signals.
  Student campus-card loss remains `procedure`; the staff campus-card case remains the narrow
  `full_guide` fixture.

The workstream is ready to enter Phase 2 structured runtime lookup/fail-close implementation.
