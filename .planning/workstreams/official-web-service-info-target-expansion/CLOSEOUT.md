---
doc_type: closeout
status: completed
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Closeout: Official Web Service Info Target Expansion

## Outcome

The workstream is closed as a target-first service-info expansion with released current
projections and remaining candidates held fail-closed:

- source-backed service-info target inventory now covers five rows
- contact and service guide rows distinguish required evidence from optional source-provided fields
- machine field review replaces human approval as the selected-write readiness gate
- selected-write release task admission requires machine field status and source lineage
- app-api and panel projections expose required evidence alongside required fields
- ingestion-owned selected-write release tasks published current structured projections for two
  contact-directory targets and one service-guide target
- runtime structured query smoke resolved the released contact-directory and service-guide facts

## Accepted Targets

- `muc-main-homepage-contact`
- `muc-information-disclosure-contact`
- `muc-information-disclosure-application-process`
- `muc-information-disclosure-application-form-download`
- `muc-it-student-campus-card-service-guide`

Released current projections:

- `campus_services/contact_directory` current release:
  `owrelease_selected_write_65cfdeede302ea2ba607dc5f_20260502_063653_527114_0000`
  includes `muc-main-homepage-contact` and carries forward
  `muc-information-disclosure-contact`.
- `muc-information-disclosure-contact`:
  `owrelease_selected_write_37bffac7b4cdde1541fa6a39_20260502_044902_977587_0000`
- `muc-it-student-campus-card-service-guide`:
  `owrelease_selected_write_58ad72a9c1a76168a4a3e491_20260502_062927_723355_0000`

Remaining retained candidates stay blocked until they have preview evidence and pass the same
machine field review gate.

## Verification

- `pnpm --filter official-web-core test -- target-inventory.test.ts policy.test.ts config.test.ts`
- `uv run --all-packages python -m unittest tests.ingestion.official_web_handoff_consumer_staging_suite tests.ingestion.test_official_web_release_task_admission tests.ingestion.test_release_official_web_selected_write`
- `uv run --all-packages python -m unittest tests.ingestion.test_run_official_web_release_task_worker tests.ingestion.test_official_web_release_task_store tests.ingestion.test_official_web_release_task_admission tests.ingestion.official_web_handoff_consumer_staging_suite tests.ingestion.test_release_official_web_selected_write`
- `cd apps/supervisor-api && go test ./internal/structuredquery ./internal/httpapi`
- `pnpm --filter app-api typecheck && pnpm --filter protected-panel-web typecheck`
- `pnpm web:lint`
- `pnpm docs:lint`
- `pnpm exec markdownlint-cli2 ".planning/workstreams/official-web-service-info-target-expansion/**/*.md" ".planning/workstreams/official-web-service-info-target-expansion/*.md"`

Runtime smoke evidence:

- `contact_directory_lookup` resolved `海南校区` to `中央民族大学` locations from the released
  contact-directory projection.
- `contact_directory_lookup` resolved `信息公开联系电话是多少` from the released contact-directory
  projection.
- `service_guide_lookup` resolved `校园卡丢了怎么挂失` from the released service-guide projection
  with source-faithful entry refs: `圈存机`、`民大通APP`、`自助补卡机`、`校园卡管理中心前台`.
- Released source pages that do not provide office hours record those optional
  fields as source-not-provided rather than treating them as expected completeness gaps or inventing
  values.

## Reopen Rule

Reopen only when:

- a new public official-web page provides optional contact/service fields that should enrich an
  existing projection
- the service-info denominator is intentionally changed in tracked config
- selected-write release task admission or app-api/panel projection drifts from this machine gate
- a ready service-info candidate needs real selected-write release and runtime consumption proof
