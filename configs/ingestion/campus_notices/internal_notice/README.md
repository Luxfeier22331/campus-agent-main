## internal_notice collection config

This directory holds the repo-tracked config contract for
`campus_notices/internal_notice`.

It explains:

- which tracked config files define current collection behavior
- which worker/materialization entrypoints consume those files
- which files are active runtime truth versus non-default supporting inputs

It does not carry:

- fixed release snapshots
- one-off operator caveats
- historical donor acceptance evidence
- archive reading guides

## Active config files

- `runtime-profile.json`
  - canonical runtime gate for import posture, serving stage, and query/retrieval admission
- `canonical-profile.json`
  - primary source unit, collection identity, and source-truth projection notes
- `chunk-profile.json`
  - current generic chunk-preparation runtime defaults
- `source-projections.v1.json`
  - source-truth replay contract for parent notices and derived attachment documents
- `notice-family-classification.v1.json`
  - read-only notice-family admission metadata used by inventory/replay/operator read models
- `promotion-routing.v1.json`
  - downstream routing scaffold for `regulations/institutional_rules` and `regulations/scoped_rules`

## Active runtime posture

Current collection posture is:

- `source_channel=authenticated_notice_portal`
- `primary_source_unit=notice`
- `serving_stage=offline_preparation`
- `retrieval_enabled=false`
- `query_enabled_by_default=false`
- `collection_visibility=restricted`
- `default_entitlement=campus_members`

Current interpretation is:

- `internal_notice` remains a source-channel-first triage collection
- it is not the canonical regulation corpus
- replay and chunk preparation truth stay separate from release / alias publish
- downstream regulation materialization consumes promoted candidates and does not rewrite this collection

## Worker / materialization consumers

- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.build_internal_notice_regulation_promotion_manifest ...`
  - read-only promotion manifest builder for `candidate / hold / manual_review_required`
- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.materialize_internal_notice_regulation_candidates ...`
  - target-collection materializer for `regulations/institutional_rules`
- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.materialize_internal_notice_scoped_rules ...`
  - target-collection materializer for `regulations/scoped_rules`

These entrypoints support repo-local snapshot mode via
`--documents-json --source-truth-inventory-json --object-store-root`.

## Non-default supporting inputs

- `historical-batches/run14-policy-regulation-core.v1.json`
- `historical-batches/run14-policy-regulation-expanded.v1.json`
- `historical-batches/run14-attachment-routing-probe.v1.json`

These files are retained bounded inputs for donor-era replay/promotion probes.
They are not the default live operator path and should not be read as current
collection truth.

## Canonical references

- `docs/reference/internal-notice-offline-preparation-strategy.md`
- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md`
- `docs/reference/internal-notice-manual-review-future-query-contract.md`
- `docs/decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `docs/decisions/adr-0037-unified-scoped-rules-holding-collection.md`
- `docs/runbooks/authenticated-notice-source-truth-replay-runbook.md`
- `docs/runbooks/internal-notice-policy-regulation-promotion-runbook.md`
- `docs/plans/internal-notice-policy-regulation-consumption-implementation.md`
