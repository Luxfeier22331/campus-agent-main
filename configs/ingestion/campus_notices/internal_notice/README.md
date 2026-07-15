# internal_notice collection config

This directory holds repo-tracked config for
`campus_notices/internal_notice`.

The collection remains a source-channel-first triage collection. It is not the
canonical regulation corpus, and it is not a generic campus-services status
tool. Active runtime work must enter through ingestion-control task admission;
Python may only appear as a private extraction adapter behind an explicit task
handler.

## Active Config Files

- `serving-config.json`
  - import posture, serving stage and query/retrieval admission
- `canonical-profile.json`
  - primary source unit, collection identity and source-truth projection notes
- `chunk-profile.json`
  - generic chunk-preparation runtime defaults
- `notice-family-classification.v1.json`
  - deterministic source family and attachment-retention classification used by
    the source collector
- `task-registry.v3.json`
  - executable Rust validation task for already-materialized canonical units

## Runtime Posture

Current defaults:

- `source_channel=internal_portal`
- `primary_source_unit=notice`
- `serving_stage=offline_preparation`
- `retrieval_enabled=false`
- `collection_visibility=restricted`
- `default_entitlement=campus_members`

Source capture enters through the central
`configs/ingestion/sources/task-registry.v3.json` task
`internal_portal.notice.capture`. This collection does not retain historical
batch, promotion, OCR, media-closeout, or consumption-table scaffolds.

## References

- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice.md`
- `docs/decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `docs/decisions/adr-0037-unified-scoped-rules-holding-collection.md`
