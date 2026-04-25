# internal_notice collection config

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
  - canonical runtime gate for import posture, serving stage, and
    query/retrieval admission
- `canonical-profile.json`
  - primary source unit, collection identity, and source-truth projection notes
- `chunk-profile.json`
  - current generic chunk-preparation runtime defaults
- `source-projections.v1.json`
  - source-truth replay contract for parent notices and derived attachment
    documents
- `notice-family-classification.v1.json`
  - read-only notice-family admission metadata used by inventory/replay/operator
    read models
  - current taxonomy covers high-value notice-level query families, service
    status candidate families, procurement/history, regulation candidates, and
    low-value defer/no-adoption families
- `routing-taxonomy-eval.v1.jsonl`
  - fixed routing taxonomy fixture consumed by the deterministic eval gate for
    `notice_family`, `suggested_consumption_route`, and
    `machine_processing_policy`
- `promotion-routing.v1.json`
  - downstream routing scaffold for `regulations/institutional_rules` and
    `regulations/scoped_rules`
- `consumption-layer-schema.sql`
  - repo-owned PG schema artifact / operator runbook for consumption projection,
    read model, admission current/event log, and multimodal attempt stores
- `multimodal-decision-eval.v1.jsonl`
  - fixed multimodal action/classification fixture consumed by the worker eval
    gate
- `multimodal-visual-eval.v1.jsonl`
  - fixed multimodal visual-understanding fixture for groundedness checks:
    required text spans, forbidden claims, required reason codes, and minimum
    confidence

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
- downstream regulation materialization consumes promoted candidates and does
  not rewrite this collection

## Worker / materialization consumers

- `uv run --package campus-ingestion-worker python -m
  campus_ingestion_worker.build_internal_notice_regulation_promotion_manifest
  ...`
  - read-only promotion manifest builder for `candidate / hold /
    requires_multimodal_processing`
- `uv run --package campus-ingestion-worker python -m
  campus_ingestion_worker.sample_authenticated_notice_routing_candidates ...`
  - read-only stratified routing sampler for notice-family taxonomy review; it
    can replay a historical bundle or sample current source-truth inventory, and
    does not create consumption admission
  - pass `--audit-output-path <path>` to write a full read-only taxonomy audit
    artifact with all `review_later` notices and deterministic clusters; this
    artifact is operator evidence, not an admission manifest
- `uv run --package campus-ingestion-worker python -m
  campus_ingestion_worker.evaluate_authenticated_notice_routing_taxonomy
  --fail-on-error`
  - deterministic routing taxonomy gate for repo-tracked JSONL fixtures; it
    validates notice family, suggested route, and machine-processing policy
    before taxonomy rule changes are promoted

Current routing taxonomy groups include:

- high-value `notice_level_query`: course/teaching, academic lifecycle,
  academic course/exam operations, academic program selection, student
  applications, student status / registration, student program / award
  selection, document collection, exchange/visit, research project,
  safety/compliance, finance/payment, health/medical, health/welfare service,
  form/template, survey collection, IT platform operations, library resources,
  library acquisition service, and operational procedures
- `service_status_candidate`: service windows, facility status, IT/platform
  status, library opening/status, transport/commute status, and
  facility/transport/classroom availability
- `defer` / low-value machine skip: lectures, activities, meeting/training,
  competition, recruitment, staff/internal admin, research publicity calls,
  governance/party life, internal governance events, general cultural publicity,
  cultural publicity activities, and campus news/publicity
- fallback `other/review_later` remains a bounded low-confidence bucket and uses
  `machine_processing_policy=skip`; it is not a VLM backlog or automatic
  consumer-admission source
- current source-truth inventory replay can be audited without bundle input;
  historical bundle replay remains supported for wider taxonomy regression
- `uv run --package campus-ingestion-worker python -m
  campus_ingestion_worker.materialize_internal_notice_regulation_candidates ...`
  - target-collection materializer for `regulations/institutional_rules`
- `uv run --package campus-ingestion-worker python -m
  campus_ingestion_worker.materialize_internal_notice_scoped_rules ...`
  - target-collection materializer for `regulations/scoped_rules`
- `uv run --package campus-ingestion-worker python -m
  campus_ingestion_worker.evaluate_internal_notice_multimodal_decisions`
  - deterministic action gate for repo-tracked multimodal decision fixtures
- `uv run --package campus-ingestion-worker python -m
  campus_ingestion_worker.evaluate_internal_notice_multimodal_visual`
  - deterministic visual fixture gate for grounded retain/no-adoption decisions;
    it uses synthetic/desensitized fixture outputs and is not a hosted eval upload

These entrypoints support repo-local snapshot mode via:

- `--documents-json`
- `--source-truth-inventory-json`
- `--object-store-root`

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
