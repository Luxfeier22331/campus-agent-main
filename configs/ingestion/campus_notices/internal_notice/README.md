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
  - owns explicit family route policy, terminal title rules, residual
    default-family overrides, machine-processing policy, and attachment
    processing policy
  - current taxonomy covers high-value notice-level query families, service
    status candidate families, procurement/history, regulation candidates, and
    low-value defer/no-adoption families
- `routing-taxonomy-eval.v1.jsonl`
  - fixed routing taxonomy fixture consumed by the deterministic eval gate for
    `notice_family`, `suggested_consumption_route`, and
    `machine_processing_policy`; eval also derives or checks
    `attachment_processing_policy` so low-value notices do not become an
    attachment/OCR backlog
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
- source OCR uses `source_ocr_provider=mineru_api`,
  `source_ocr_model=vlm`, and
  `source_ocr_image_routing_strategy=mineru_primary`
- `source_ocr_fallback_enabled=true`; Paddle async OCR remains the fallback
  provider when a MinerU image/attachment attempt fails and Paddle credentials
  are configured
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
  - inventory mode reads source-truth `content-blocks.jsonl` when object-store
    env is available so residual routing can use body text; pass
    `--skip-content-blocks` for fast title/type-only sampling
  - pass `--audit-output-path <path>` to write a full read-only taxonomy audit
    artifact with terminal default-family residual notices and deterministic
    clusters; this artifact is operator evidence, not an admission manifest
- `uv run --package campus-ingestion-worker python -m
  campus_ingestion_worker.evaluate_authenticated_notice_routing_taxonomy
  --fail-on-error`
  - deterministic routing taxonomy gate for repo-tracked JSONL fixtures; it
    validates notice family, suggested route, and machine-processing policy
    before taxonomy rule changes are promoted

Current routing taxonomy groups include:

- `regulation_candidate`: stable policy/regulation texts such as management
  measures, implementation rules, implementation measures, provisions,
  management norms, implementation opinions, charters, bylaws, and work
  procedures; learning sessions, interpretation meetings, promotional
  materials, plans, and reports are not treated as regulation bodies
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
- fallback `other` with no actionable signal closes as terminal `no_adoption`
  with `machine_processing_policy=skip`; deterministic high-confidence clusters
  are promoted into explicit routes, while clearly unconsumable terminal titles
  such as obituaries also close as `no_adoption`. Bare "通知/公告/通告" titles
  require source-truth body text before they can be promoted into a service or
  action route. There is no deferred human handling state in this taxonomy
- attachment processing policy is derived from route: admitted high-value
  routes with attachment refs use `process`; body-only admitted routes use
  `not_required`; `defer` and `no_adoption` use
  `metadata_only`, meaning source-truth may retain attachment facts but
  operator补采不应下载、OCR、materialize, or send them to multimodal processing
- current source-truth inventory replay can be audited without bundle input;
  historical bundle replay remains supported for wider taxonomy regression
- `uv run --package campus-ingestion-worker python -m
  campus_ingestion_worker.materialize_internal_notice_regulation_candidates ...`
  - target-collection materializer for `regulations/institutional_rules`
- `uv run --package campus-ingestion-worker python -m
  campus_ingestion_worker.dry_run_internal_notice_regulation_document_site ...`
  - selected dry-run path for `regulation_candidate` notices
  - writes local `regulations/institutional_rules` and `regulations/scoped_rules`
    registry/object-store artifacts plus canonical document reader assets from
    snapshot inputs
  - uses `target_surface=regulations/*` for admission, then lets consumption
    projection resolve each notice into its concrete regulation target scope
  - reads the input object-store snapshot but writes generated objects into the
    dry-run output overlay
  - stops before release, retrieval/index preparation, and query-serving
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
