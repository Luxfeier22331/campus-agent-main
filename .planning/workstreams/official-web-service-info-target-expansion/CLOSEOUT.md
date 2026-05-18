---
doc_type: closeout
status: completed
created: 2026-05-02
updated: 2026-05-03
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
  contact-directory targets and three service-guide targets
- runtime structured query smoke resolved the released contact-directory and service-guide facts

## Accepted Targets

- `muc-main-homepage-contact`
- `muc-information-disclosure-contact`
- `muc-information-disclosure-application-process`
- `muc-information-disclosure-application-form-download`
- `muc-it-student-campus-card-service-guide`

Released current projections:

- `campus_services/contact_directory` current:
  - `owrelease_selected_write_c3ab739b6ee31a47d3cc019d_20260503_203838_671850_0000`
  - `owrelease_selected_write_dcb739800954549b943af6bc_20260503_204029_141565_0000`
  - resulting current records:
    - `中央民族大学`
    - `中央民族大学信息公开联系方式`
    - `中央民族大学信息化服务联系方式`
- `campus_services/service_guide` current:
  - `owrelease_selected_write_58ad72a9c1a76168a4a3e491_20260502_062927_723355_0000`
  - `owrelease_selected_write_2de6b7953acd82bd5e01cf04_20260503_204120_258697_0000`
  - `owrelease_selected_write_a2788e7d99692107bb18d4df_20260503_204132_314985_0000`
  - `owrelease_selected_write_88ead76d67c13db4345e4306_20260503_204141_443843_0000`
  - resulting current records:
    - `学生校园卡服务`
    - `中央民族大学信息公开依申请公开工作流程`
    - `中央民族大学校园网认证及使用说明`
    - `中央民族大学校园电子邮件服务`
    - `中央民族大学 VPN 使用说明`

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
- Real operator evidence on 2026-05-03:
  - `/api/operator/official-web/release-tasks?status=published&limit=20` returned the five promoted
    selected-write tasks as `published`
  - `/api/operator/official-web/release-tasks/owrelease_selected_write_88ead76d67c13db4345e4306`
    returned the expected published detail projection
- Post-promotion deterministic gates:
  - `contact-directory-lookup-release-gate.json`: `total_checks=5`, `passed_checks=5`
  - `service-guide-lookup-release-gate.json`: `total_checks=5`, `passed_checks=5`

Known residual gap:

- `service_guide` release-task operator projection currently exposes `recordCount` but does not yet
  expose `fullRecordCount`, `taskScopeDisplayNames`, or `fullImpactDisplayNames`. The richer
  selected-write impact summary is already present for `contact_directory`.

Next admitted target starting point:

- `muc-information-disclosure-application-process` + `muc-information-disclosure-application-form-download`
  - owner surface: `service_guide_lookup`
  - selected-write target: `campus_services/service_guide`
  - current posture: retained composition group, still blocked
  - why next: the form-download page should not be promoted alone; it must be re-evaluated as a
    composition component of the existing information-disclosure application flow so `service_process`
    can be source-backed without reopening broad crawl

## Reopen Rule

Reopen only when:

- a new public official-web page provides optional contact/service fields that should enrich an
  existing projection
- the service-info denominator is intentionally changed in tracked config
- selected-write release task admission or app-api/panel projection drifts from this machine gate
- a ready service-info candidate needs real selected-write release and runtime consumption proof
