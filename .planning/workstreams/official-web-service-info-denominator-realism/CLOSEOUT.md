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
- Re-reviewed the end-to-end collector/tool boundary after runtime gate wiring:
  target-first collection still enters as source-truth candidates, selected-write admission and
  release mutation remain ingestion-owned, and `service_guide_lookup` now fails closed when a user
  explicitly asks for a contact subfield that the source marked `source_not_provided`.
- Added a read-only `service_guide_lookup` selected-write runtime smoke into the release gate as an
  opt-in check. It starts `supervisor-api` as a local process, reads the current local Postgres
  `campus_services/service_guide` projection, and verifies procedure, responsible-office and
  source-not-provided phone behavior without writing collector, selected-write or current-truth
  data.

## Drift Review

Current implementation matches the target boundary:

- `official-web-collector` / target worksets only retain matched source-truth and consumer metadata;
  they do not write structured current truth.
- `ingestion-worker` builds target field reviews, admits selected-write release tasks, claims and
  runs selected-write publication, and writes the structured projection current read model.
- `apps/app-api` keeps official-web run/control-plane ledgers, operator-safe target inventory
  projection and release-task processing projection. It does not expose contact/service
  selected-write admission or executor mutation routes; stable-reference release gates remain the
  separate operator command-ledger path.
- `service_guide_lookup` consumes only the structured projection read model. Optional source gaps
  remain query-visible as `source_not_provided`; explicit phone/email/location/office-hour queries
  fail closed instead of returning a partial contact as if the requested field existed.

Remaining known limitation:

- `muc-information-disclosure-application-form-download` is still not a standalone current service
  guide because the page contributes material/form evidence but does not publish complete
  release-blocking process evidence on its own. Multi-page composition is intentionally outside this
  workstream and should be reopened only with a separate composition contract.

## Reopen Rule

Reopen only if required/optional denominator policy changes, `source_not_provided` no longer
propagates through selected-write evidence, operator projections drop optional metadata, or a new
service-info source family needs a different release-blocking denominator.
