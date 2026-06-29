# internal_notice collection config

This directory holds repo-tracked config for
`campus_notices/internal_notice`.

The collection remains a source-channel-first triage collection. It is not the
canonical regulation corpus, and it is not a generic campus-services status
tool. Active runtime work must enter through ingestion-control task admission;
Python may only appear as a private extraction adapter behind an explicit task
handler.

## Active Config Files

- `runtime-profile.json`
  - import posture, serving stage and query/retrieval admission
- `canonical-profile.json`
  - primary source unit, collection identity and source-truth projection notes
- `chunk-profile.json`
  - generic chunk-preparation runtime defaults
- `source-projections.v1.json`
  - source-truth replay contract for parent notices and derived attachment
    documents
- `notice-family-classification.v1.json`
  - read-only family admission, route policy and attachment-processing policy
- `routing-taxonomy-eval.v1.jsonl`
  - deterministic taxonomy fixture
- `promotion-routing.v1.json`
  - downstream regulation promotion scaffold
- `consumption-layer-schema.sql`
  - PG schema artifact/operator runbook for consumption projection stores
- `multimodal-decision-eval.v1.jsonl`
  - fixed multimodal action/classification fixture
- `multimodal-visual-eval.v1.jsonl`
  - fixed visual-groundedness fixture

## Runtime Posture

Current defaults:

- `source_channel=authenticated_notice_portal`
- `primary_source_unit=notice`
- `serving_stage=offline_preparation`
- `retrieval_enabled=false`
- `query_enabled_by_default=false`
- `collection_visibility=restricted`
- `default_entitlement=campus_members`

OCR/multimodal source processing uses MinerU according to the authenticated
notice owner docs. Provider failures fail closed and require explicit review or
adjudication paths.

## Non-Default Supporting Inputs

- `historical-batches/run14-policy-regulation-core.v1.json`
- `historical-batches/run14-policy-regulation-expanded.v1.json`
- `historical-batches/run14-attachment-routing-probe.v1.json`

These files are bounded replay/promotion probe inputs. They are not default live
operator paths.

## References

- `docs/architecture/domains/authenticated-notice/architecture.md`
- `docs/data/authenticated-notice.md`
- `docs/decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`
- `docs/decisions/adr-0037-unified-scoped-rules-holding-collection.md`
