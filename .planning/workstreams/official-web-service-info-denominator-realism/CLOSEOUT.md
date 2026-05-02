---
doc_type: closeout
status: completed
created: 2026-05-02
updated: 2026-05-02
---

<!-- markdownlint-disable MD013 -->

# Closeout: Official Web Service Info Denominator Realism

## Completed

- Added required/optional denominator semantics to official-web config, target-source-map and target
  inventory.
- Changed contact directory release-blocking evidence to `phone`; email/location/office hours are
  optional.
- Changed service guide release-blocking evidence to `service_process`; entry/material/contact facts
  are optional.
- Added `source_not_provided` as the machine status for absent optional facts.
- Updated collector matching so optional evidence can retain source-truth without making it
  selected-write ready.
- Updated ingestion field review, release task admission and release execution to validate required
  and optional fields separately.
- Updated app-api and protected panel target inventory projections to expose optional metadata.

## Reopen Rule

Reopen only if required/optional denominator policy changes, `source_not_provided` no longer
propagates through selected-write evidence, operator projections drop optional metadata, or a new
service-info source family needs a different release-blocking denominator.
