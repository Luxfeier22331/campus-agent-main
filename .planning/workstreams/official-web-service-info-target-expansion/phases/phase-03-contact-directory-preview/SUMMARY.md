---
doc_type: summary
status: completed
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Phase 3 Summary: Contact Directory Preview

## Completed

- Contact target inventory now requires source-backed `phone` evidence and records `email`,
  `location` and `office_hours` only when the source provides them.
- Operator report blocks contact selected-write when required evidence or lineage is missing.
- Ingestion review can mark a fully extracted contact candidate ready without a human approval
  manifest.

## Real Target Verdict

`muc-main-homepage-contact` has replayable preview evidence and machine field review. It is released
into the current `campus_services/contact_directory` projection together with the carried-forward
`muc-information-disclosure-contact` record. Missing email or office hours from the source is not a
release blocker.

## Verification

- `pnpm --filter official-web-core test -- target-inventory.test.ts policy.test.ts config.test.ts`
- `uv run --all-packages python -m unittest tests.ingestion.official_web_handoff_consumer_staging_suite`
