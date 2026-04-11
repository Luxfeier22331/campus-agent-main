## internal_notice collection config

This directory holds the repo-tracked config scaffolding for the
`internal_notice` collection within the `campus_notices` corpus.

- `runtime-profile.json`: canonical runtime gate for bootstrap import plus serving policy
- `canonical-profile.json`: primary source unit, identity strategy, and projection notes
- `chunk-profile.json`: current generic runtime defaults for chunk preparation admission
- `source-projections.v1.json`: offline source-truth replay contract for clean parent notices and derived attachment documents
- `notice-family-classification.v1.json`: read-only notice-family admission config for policy-first stratification
- `promotion-routing.v1.json`: source-side scaffold for deciding which canonical documents may be promoted into `regulations/institutional_regulations`
- `historical-batches/run14-policy-regulation-core.v1.json`: first curated donor intake batch for stable regulation/policy notices
- `historical-batches/run14-policy-regulation-expanded.v1.json`: broader policy_regulation donor batch with body-shape stratification for policy-text handling
- `historical-batches/run14-attachment-routing-probe.v1.json`: second curated donor intake batch for attachment route coverage (`text_extractable` / `ocr_required` / `reference_only`)
- `docs/runbooks/authenticated-notice-historical-donor-intake-runbook.md`: controlled donor normalization + local smoke workflow
- `docs/reference/authenticated-notice-historical-donor-intake-evidence.md`: current accepted evidence for the donor intake batches
- `docs/reference/internal-notice-offline-preparation-strategy.md`: collection-specific offline preparation and lane strategy
- `docs/reference/internal-notice-offline-preparation-quality-acceptance.md`: collection-specific quality acceptance criteria before any index release
- `docs/decisions/adr-0035-notice-derived-regulation-promotion-boundary.md`: freeze that `internal_notice` remains source/triage and canonical regulation text must cross a separate promotion boundary
- `docs/plans/internal-notice-policy-regulation-consumption-implementation.md`: forward implementation plan for promoting `policy_regulation` notice content from `internal_notice` into a dedicated `regulations/*` target without rewriting current merged truth
- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.build_internal_notice_regulation_promotion_manifest ...`: read-only promotion manifest builder for `candidate / hold / manual_review_required` stratification before any target-collection writes; supports repo-local snapshot mode via `--documents-json --source-truth-inventory-json --object-store-root`
- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.materialize_internal_notice_regulation_candidates ...`: repo-owned post-release consumption worker that materializes `promote_candidate` rows into `regulations/institutional_regulations` via scope refresh; also supports repo-local snapshot mode via `--documents-json --source-truth-inventory-json --object-store-root`
- `.planning/archive-docs/docs/plans/authenticated-notice-source-attachment-key-reorganization.md`: 已完成的 source bucket attachment key cleanup 历史方案

Current runtime truth:

- source channel: `authenticated_notice_portal`
- primary source unit: `notice`
- serving stage: `offline_preparation`
- retrieval enabled: `false`
- query enabled by default: `false`
- collection visibility baseline: `restricted`
- default entitlement baseline: `campus_members`

Current guarded release truth:

- local Postgres Wave D chain is fully closed through:
  - `closeout_run_id=local-postgres-wave-d-full-20260410-141615`
  - `preparation_run_id=prep-local-postgres-wave-d-full-20260410-141615`
  - `promotion_id=promotion-0001`
  - `release_id=r20260411_090101`
  - `physical_collection_name=internal_notice__r20260411_090101`
- current release manifest facts:
  - `document_count=21`
  - `point_count=213`
  - `validation_status=passed`
  - `published_at=null`
- `internal_notice` alias intentionally remains unpublished; this collection is still `restricted + offline_preparation`
- current WSL operator shells must blank uppercase/lowercase proxy vars before Qdrant Cloud release or inspection commands; simple `env -u HTTP_PROXY ...` is not sufficient in this repo bootstrap path

`internal_notice` is the first restricted rollout target for authenticated portal notices.
It is intentionally isolated from public surfaces and should not be exposed as a default
query-serving collection until restricted document authorization, projection, and leakage
guards are verified end-to-end.

It is also explicitly a source-channel-first triage collection, not a formal regulation
collection. Wrapper notices, attachment outcome truth, and replay evidence remain here;
only separately promoted canonical regulation text may later enter `regulations/*`.

Offline source-truth replay rules:

- parent notice documents only carry notice body structure
- attachment refs remain in source-truth and do not participate in parent chunk identity
- downloaded attachments are materialized as derived restricted child documents

Current chunk-preparation truth:

- parent notice and attachment child docs must not share one global quality target
- the current `220/320/32/32` values are generic runtime defaults, not the final lane-specific semantic policy
- verified chunk preparation is a separate stage from `release_registry_scope`
- `release_registry_scope` now requires an explicit successful `preparation_run_id`
- structural preparation pass is not quality acceptance; attachment cleanup / extraction / chunk quality must be accepted separately
- notice-family stratification is a read-only admission layer above replay/preparation; it does not rewrite source-truth or attachment routing
- repo-local live collector notice-type config may intentionally be narrower than historical donor scope; current tracked live default only enables `5 / 办公通知`
- historical donor processing still starts from full bundle family analysis, then admits `policy_regulation` first; current repo-tracked policy batches now include both a small governance core batch and a broader 16-notice expanded batch before cross-family attachment probes
- verified chunk preparation may advance into `release_registry_scope --no-publish-alias`, but alias publish remains a separate operator decision

Accepted attachment-consumption design:

- `docx` default lane: `text_extractable`
- `pdf` default lane: `ocr_required`
- policy / handbook `pdf` should trust cloud async OCR as the canonical extraction path
- native PDF extraction is only a diagnostics / quality-probe path, not the default success path

Current promotion-manifest guardrails:

- `notice_body` parent rows may only become promotion candidates when the body itself has standalone regulation structure; wrapper summaries stay in `internal_notice`
- time-bound or campaign-specific body text such as `暂行`、假期期间规定、招生/推免/硕博连读实施细则 currently degrades to `manual_review_required`, even if the body is structurally clean
- if inventory expects attachment child docs but the current snapshot does not contain them, the manifest must emit `manual_review_required` rather than a business hold/candidate result
- attachment provenance fields remain mandatory for attachment-derived candidates, but stay nullable for parent-body candidates

Current post-release consumption truth:

- `internal_notice` 当前已经具备 repo-owned target-collection consumption path：
  - `build_internal_notice_regulation_promotion_manifest`
  - `materialize_internal_notice_regulation_candidates`
- 这条路径只会刷新 `regulations/institutional_regulations` 的 registry/object-store truth
- 它不会改写 `campus_notices/internal_notice`
- 它不会自动执行 chunk preparation、embedding、Qdrant write、release 或 alias publish

Current config sync note:

- the accepted design above is now documented by `docs/decisions/adr-0033-internal-notice-pdf-cloud-ocr-default.md`
- `source-projections.v1.json` now routes `pdf` into `ocr_required`, includes `application/pdf`, and uses the broadened OCR kind metadata needed by replay artifacts

Live taxonomy reference:

- `docs/reference/authenticated-notice-portal-live-observations.md`
- `docs/reference/authenticated-notice-historical-donor-intake-evidence.md`

Read-only notice-family analysis entry:

- `uv run --package campus-ingestion-worker python -m campus_ingestion_worker.analyze_authenticated_notice_notice_families --bundle-path <notices-bundle.json>`

Historical donor normalization + local smoke entry:

- `docs/runbooks/authenticated-notice-historical-donor-intake-runbook.md`
