---
doc_type: closeout
status: completed
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Closeout: Official Web Service Info Target Expansion

## Outcome

The workstream is closed as a fail-closed service-info expansion:

- source-backed target inventory was expanded from 3 to 4 rows
- contact and service guide rows now carry the full denominator
- machine field review replaces human approval as the selected-write readiness gate
- selected-write release task admission requires machine field status and source lineage
- app-api and panel projections expose required evidence alongside required fields
- no current structured projection was written because current real targets do not satisfy the full
  denominator

## Accepted Targets

- `muc-main-homepage-contact`
- `muc-information-disclosure-application-process`
- `muc-information-disclosure-application-form-download`

All three service-info targets remain blocked for selected-write until source facts cover the full
denominator or the denominator config is explicitly changed in a later workstream.

## Verification

- `pnpm --filter official-web-core test -- target-inventory.test.ts policy.test.ts config.test.ts`
- `uv run --all-packages python -m unittest tests.ingestion.official_web_handoff_consumer_staging_suite tests.ingestion.test_official_web_release_task_admission tests.ingestion.test_release_official_web_selected_write`
- `pnpm --filter app-api typecheck && pnpm --filter protected-panel-web typecheck`
- `pnpm web:lint`
- `pnpm docs:lint`
- `pnpm exec markdownlint-cli2 ".planning/workstreams/official-web-service-info-target-expansion/**/*.md" ".planning/workstreams/official-web-service-info-target-expansion/*.md"`

## Reopen Rule

Reopen only when:

- a new public official-web page provides missing contact/service denominator fields
- the service-info denominator is intentionally changed in tracked config
- selected-write release task admission or app-api/panel projection drifts from this machine gate
- a ready service-info candidate needs real selected-write release and runtime consumption proof
