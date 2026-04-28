---
doc_type: evidence
status: complete
created: 2026-04-28
updated: 2026-04-28
phase: Phase 9
workstream: authenticated-notice-service-status-consumption
---
# Evidence: Phase 9 Current Release Composition And Safe Promotion

<!-- markdownlint-disable MD013 -->

## Result

Phase 9 composed and promoted the current service-status release
`service-status-current-20260428T122000`.

Current records:

- `355650`: `facility:bathroom:jingyuan-10`
- `354845`: `service-counter:campus-hospital`

Rejected historical candidates:

- `247726`
- `352345`
- `354502`
- `354575`
- `354674`

Transport schedule candidates were excluded from this service-status current
release.

## Evidence Files

- `current-candidate-audit.json`
- `current-composition-plan.json`
- `consumer-admission-manifest.json`
- `service-status-current-stage.stdout.json`
- `service-status-current-stage/build-report.json`
- `service-status-current-stage/service-status-current-20260428T122000/service-status-projection.json`
- `service-status-current-stage/service-status-current-20260428T122000/rejected-source-report.json`
- `pg-current-before-stage.json`
- `pg-current-after-stage.json`
- `pg-current-after-promote.json`
- `pg-list-after-stage.json`
- `pg-list-after-promote.json`
- `service-status-current-promote.stdout.json`
- `service-status-current-promote/current/service-status-projection.json`
- `pg-current-read-model-smoke.json`
- `supervisor-service-status-multi-current-smoke.json`
- `app-api-public-chat-multi-current-smoke.json`

## Safety Properties

- Stage wrote versioned artifacts and PG release/read-model rows but did not
  move PG current pointer.
- Promote moved PG current pointer to the staged release and wrote the current
  object artifact.
- Current read model contains two records and five rejected historical sources.
- Runtime lookup resolves both current records through PostgreSQL current truth.
- App API visible answer normalizes status in Chinese, shows low-distraction
  source cards, and hides raw locators, release ids and the `2099` sentinel.
